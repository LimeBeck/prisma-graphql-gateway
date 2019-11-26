import {
  makeRemoteExecutableSchema,
  introspectSchema,
  mergeSchemas
} from 'graphql-tools';
import { HttpLink } from 'apollo-link-http';
import { setContext } from 'apollo-link-context';
import { ApolloServer } from 'apollo-server';
import fetch from 'node-fetch';
import { getMainDefinition } from 'apollo-utilities';
import WebSocket from 'ws';
import { WebSocketLink } from 'apollo-link-ws';
import { SubscriptionClient } from 'subscriptions-transport-ws';

const createWsLink = (gqlServerUrl) => {
  const wsUri = gqlServerUrl.replace("http://", "ws://").replace("https://", "wss://").replace(/\/+$/, '') + "/ws"
  console.log(`WS link: ${wsUri}`)
  const wsClient = new SubscriptionClient(
    wsUri,
    {
      reconnect: true // if connection is lost, retry
    },
    WebSocket,
    []
  );
  return new WebSocketLink(wsClient);
};

if (!process.env.ENDPOINTS)
  throw new Error("<8ed79eaf> ENDPOINTS env is not provided")

const graphqlApis = process.env.ENDPOINTS.split(',')

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForEndpoint(endpoint) {

  console.debug(`<515d0545> Wait for ${endpoint} endpoint....`)
  while (true) {

    try {

      let response = await fetch(endpoint, {
        method: "POST",
        body: '{"query":"{ __schema { types { name } }}"}',
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      });

      if (response.ok)
        break;

    } catch (e) {
    }

    await sleep(1000);
  }

  console.debug(`<576ed8a5> Endpoint is ok: ${endpoint}`)
}

// create executable schemas from remote GraphQL APIs
const createRemoteExecutableSchemas = async () => {
  let schemas = [];
  for (const api of graphqlApis) {

    await waitForEndpoint(api);

    const http = new HttpLink({
      uri: api,
      fetch
    });

    const wsLink = createWsLink(api)

    const link = setContext(function (request, previousContext) {
      let authKey;
      if (previousContext.graphqlContext) {
        authKey = previousContext.graphqlContext.authKey;
      }
      console.log("Child Authorization: " + authKey || 'None');
      if (authKey) {
        return {
          headers: {
            'Authorization': `${String(authKey)}`,
          }
        }
      } else {
        return {
          headers: {}
        }
      }
    })
    .split(
      ({ query }) => {
        const { kind, operation } = getMainDefinition(query);
        return kind === 'OperationDefinition' && operation === 'subscription';
      },
      wsLink,
      http
    );

    const remoteSchema = await introspectSchema(link);
    const remoteExecutableSchema = makeRemoteExecutableSchema({
      schema: remoteSchema,
      link
    });
    schemas.push(remoteExecutableSchema);
  }
  return schemas;
};

const createNewSchema = async () => {
  const schemas = await createRemoteExecutableSchemas();
  return mergeSchemas({
    schemas
  });
};

const runServer = async () => {
  // Get newly merged schema
  const schema = await createNewSchema();
  // start server with the new schema
  const server = new ApolloServer({
    schema,
    subscriptions: {
      path: "/graphql"
    },
    context: ({ req }) => {
      // get the user token from the headers
      if(req){
        const authKey = req.headers.authorization || '';
        console.log("Parent Authorization: " + authKey);
  
        // add the token to the context
        return { authKey };
      } else {
        return {}
      }
    }
  });
  server.listen().then(({ url }) => {
    console.log(`Running at ${url}`);
  });
  server.httpServer.setTimeout(10 * 60 * 1000);
};

try {
  runServer();
} catch (err) {
  console.error(err);
}
