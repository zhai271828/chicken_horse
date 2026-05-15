/**
 * Cloudflare Worker entry point
 * Routes requests to GameRoom Durable Objects
 */

export { GameRoom } from './GameRoom.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // Root path - return status page
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(
        JSON.stringify({
          name: 'Chicken Horse Game Server',
          status: 'running',
          endpoints: {
            health: '/health',
            createRoom: '/api/create-room',
            websocket: '/room/{roomId}/websocket',
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // API routes
    if (url.pathname === '/api/create-room') {
      return handleCreateRoom(request, env);
    }

    if (url.pathname === '/api/rooms') {
      return handleListRooms(request, env);
    }

    // WebSocket connection to a specific room
    if (url.pathname.startsWith('/room/')) {
      const roomId = url.pathname.split('/')[2];
      return handleRoomConnection(roomId, request, env);
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

/**
 * Handle creating a new room
 */
async function handleCreateRoom(request, env) {
  const body = await request.json();
  const { playerName, character } = body;

  // Generate a room ID
  const roomId = generateRoomId();
  console.log('[Worker] Creating room:', roomId);

  // Get or create the GameRoom Durable Object using roomId as name
  // This ensures the same roomId always maps to the same Durable Object
  const id = env.GAME_ROOM.idFromName(roomId);
  const gameRoom = env.GAME_ROOM.get(id);

  // Initialize the room with roomId
  const initResponse = await gameRoom.fetch(
    new Request('https://internal/init', {
      method: 'POST',
      body: JSON.stringify({ roomId, playerName, character }),
    })
  );

  const initData = await initResponse.json();
  console.log('[Worker] Room initialized:', initData);

  return new Response(
    JSON.stringify({
      roomId,
      websocketUrl: `/room/${roomId}/websocket`,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}

/**
 * Handle listing active rooms
 */
async function handleListRooms(request, env) {
  // Note: Durable Objects don't support listing all instances
  // In production, you'd use KV or D1 to track room IDs
  return new Response(
    JSON.stringify({
      message: 'Room listing requires additional storage',
      rooms: [],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}

/**
 * Handle WebSocket connection to a room
 */
async function handleRoomConnection(roomId, request, env) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  // Get the GameRoom Durable Object using the roomId as the name
  // This ensures the same roomId always maps to the same Durable Object
  const id = env.GAME_ROOM.idFromName(roomId);
  const gameRoom = env.GAME_ROOM.get(id);

  // Forward the original request untouched so the Upgrade headers survive in
  // production. Re-wrapping the Request works locally in Miniflare, but can
  // break the WebSocket handshake on Cloudflare edge.
  return gameRoom.fetch(request);
}

/**
 * Handle CORS preflight requests
 */
function handleOptions(request) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/**
 * Generate a random room ID
 */
function generateRoomId() {
  const chars = '0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
