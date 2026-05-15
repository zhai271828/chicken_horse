/**
 * NetworkManager - Handles WebSocket connection to the game server
 *
 * Manages connection, message sending/receiving, and reconnection logic.
 */

export class NetworkManager {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.roomId = null;
    this.connected = false;
    this.handlers = new Map();
    this.lastMessages = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.lastInputTime = 0;
    this.inputThrottle = 16; // ms between input sends (~60 updates/sec)
  }

  /**
   * Connect to the game server
   * @param {string} workerUrl - The WebSocket URL of the worker
   * @returns {Promise<void>}
   */
  async connect(workerUrl) {
    return new Promise((resolve, reject) => {
      try {
        this.lastMessages.delete('WELCOME');
        this.ws = new WebSocket(workerUrl);

        this.ws.onopen = () => {
          console.log('[Network] Connected to server');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('[Network] Message parse error:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('[Network] Disconnected:', event.code, event.reason);
          this.connected = false;
          this.emit('disconnected', { code: event.code, reason: event.reason });
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[Network] WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming message
   */
  handleMessage(message) {
    const { type, data } = message;
    if (type !== 'GAME_STATE' && type !== 'PLAYER_INPUT') {
      this.lastMessages.set(type, data);
    }

    // Debug: log all received messages (skip noisy GAME_STATE and PLAYER_INPUT)
    if (type !== 'GAME_STATE' && type !== 'PLAYER_INPUT' && type !== 'connected') {
      console.log(`[Network] <<< ${type}`, data ? JSON.stringify(data).substring(0, 80) : '');
    }

    // Special handling for certain messages
    switch (type) {
      case 'WELCOME':
        this.playerId = data.playerId;
        if (data.roomId) {
          this.roomId = data.roomId;
        }
        console.log('[Network] Assigned player ID:', this.playerId, 'Room:', this.roomId);
        break;

      case 'ROOM_CREATED':
      case 'ROOM_JOINED':
        this.roomId = data.roomId;
        this.playerId = data.playerId || this.playerId;
        console.log('[Network] Room joined:', this.roomId, 'Player:', this.playerId);
        break;

      case 'PLAYER_INPUT':
        // Forwarded remote input for the host. Keep this quiet; logging every
        // input packet causes visible frame drops during network play.
        break;

      case 'ERROR':
        console.error('[Network] Server error:', data.message);
        break;
    }

    // Emit to registered handlers
    this.emit(type, data);
  }

  /**
   * Register an event handler
   * @param {string} type - Message type
   * @param {Function} handler - Handler function
   */
  on(type, handler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type).push(handler);
  }

  /**
   * Remove an event handler
   * @param {string} type - Message type
   * @param {Function} handler - Handler function to remove
   */
  off(type, handler) {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event to all registered handlers
   */
  emit(type, data) {
    const handlers = this.handlers.get(type) || [];
    const noisyTypes = ['GAME_STATE', 'PLAYER_INPUT', 'connected', 'disconnected', 'reconnecting', 'error'];
    if (handlers.length === 0 && !noisyTypes.includes(type)) {
      console.warn(`[Network] No handlers for ${type}`);
    }
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        console.error(`[Network] Handler error for ${type}:`, error);
      }
    }
  }

  /**
   * Send a message to the server
   * @param {string} type - Message type
   * @param {Object} data - Message data
   */
  send(type, data) {
    if (!this.connected || !this.ws) {
      return false;
    }

    try {
      this.ws.send(
        JSON.stringify({
          type,
          data,
          timestamp: Date.now(),
        })
      );
      return true;
    } catch (error) {
      console.error('[Network] Send error:', error);
      return false;
    }
  }

  /**
   * Create a new room
   * @param {string} playerName - Player's display name
   * @param {string} character - Selected character
   * @returns {Promise<Object>} Room data
   */
  async createRoom(playerName, character) {
    this.lastMessages.delete('ROOM_CREATED');
    this.send('CREATE_ROOM', { playerName, character });
    return this.waitFor('ROOM_CREATED', 5000);
  }

  /**
   * Join an existing room
   * @param {string} roomId - Room ID to join
   * @param {string} playerName - Player's display name
   * @param {string} character - Selected character
   * @returns {Promise<Object>} Room data
   */
  async joinRoom(roomId, playerName, character) {
    this.lastMessages.delete('ROOM_JOINED');
    this.send('JOIN_ROOM', { roomId, playerName, character });
    return this.waitFor('ROOM_JOINED', 5000);
  }

  /**
   * Send player input to the server
   * @param {Object} input - { left, right, jump }
   */
  sendInput(input) {
    if (!this.connected) return;
    const now = Date.now();
    if (now - this.lastInputTime < this.inputThrottle) return;

    this.lastInputTime = now;
    this.send('PLAYER_INPUT', {
      playerId: this.playerId,
      input: input,
    });
  }

  /**
   * Place an obstacle
   * @param {string} type - Obstacle type
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {string} direction - Optional direction
   */
  placeObstacle(type, x, y, direction, extra = {}) {
    this.send('PLACE_OBSTACLE', { type, x, y, direction, ...extra });
  }

  /**
   * Undo a previously confirmed placement during the network build phase.
   * @param {string} id - Obstacle id assigned by the server
   */
  undoObstacle(id) {
    this.send('UNDO_OBSTACLE', { id });
  }

  /**
   * Buy an obstacle from the shop
   * @param {string} type - Obstacle type
   */
  buyObstacle(type) {
    this.send('BUY_OBSTACLE', { type });
  }

  /**
   * Toggle ready status
   */
  setReady() {
    this.send('PLAYER_READY', {});
  }

  /**
   * Select a character
   * @param {string} character - Character name
   */
  selectCharacter(character) {
    this.send('SELECT_CHARACTER', { character });
  }

  /**
   * Select the starting map for a room (host only).
   * @param {string} mapKey - map1 or map2
   * @param {number} bgIndex - background index for sync
   */
  selectMap(mapKey, bgIndex) {
    this.send('SELECT_MAP', { mapKey, bgIndex });
  }

  /**
   * Start the game (host only)
   * @param {Object} opts - { mapKey, bgIndex } optional map/background sync
   */
  startGame(opts) {
    this.send('START_GAME', opts || {});
  }

  setPause(paused) {
    this.send(paused ? 'PAUSE_GAME' : 'RESUME_GAME', {});
  }

  /**
   * Use eraser at position
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   */
  useEraser(x, y) {
    this.send('USE_ERASER', { x, y });
  }

  /**
   * Purchase an item during simultaneous shop phase
   * @param {string} type - Obstacle type to buy
   */
  shopPurchase(type) {
    this.send('SHOP_PURCHASE', { type });
  }

  /**
   * Signal that this player is done shopping
   */
  shopDone() {
    this.send('SHOP_DONE', {});
  }

  /**
   * Signal that this player is done placing obstacles
   */
  buildDone() {
    this.send('BUILD_DONE', {});
  }

  /**
   * Signal that this player has finished reading the round results.
   */
  resultsDone() {
    this.send('RESULTS_DONE', {});
  }

  /**
   * Wait for a specific message type
   * @param {string} type - Message type to wait for
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<Object>} Message data
   */
  waitFor(type, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (this.lastMessages.has(type)) {
        const data = this.lastMessages.get(type);
        this.lastMessages.delete(type);
        resolve(data);
        return;
      }

      const timer = setTimeout(() => {
        this.off(type, handler);
        reject(new Error(`Timeout waiting for ${type}`));
      }, timeout);

      const handler = (data) => {
        clearTimeout(timer);
        this.off(type, handler);
        resolve(data);
      };

      this.on(type, handler);
    });
  }

  /**
   * Consume the latest cached message of a given type, if one arrived before a
   * state registered its handler.
   * @param {string} type - Message type
   * @returns {Object|undefined} Message data
   */
  consumeLast(type) {
    if (!this.lastMessages.has(type)) return undefined;
    const data = this.lastMessages.get(type);
    this.lastMessages.delete(type);
    return data;
  }

  /**
   * Attempt to reconnect to the server
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Network] Max reconnection attempts reached');
      this.emit('reconnect_failed');
      return;
    }

    // Save state for rejoin after reconnect
    const savedPlayerId = this.playerId;
    const savedRoomId = this.roomId;
    const savedUrl = this.ws?.url;

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[Network] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    setTimeout(() => {
      if (savedUrl) {
        this.connect(savedUrl).then(() => {
          // Rejoin with saved credentials
          if (savedPlayerId && savedRoomId) {
            this.send('REJOIN', { playerId: savedPlayerId, roomId: savedRoomId });
            console.log('[Network] Rejoin sent for player:', savedPlayerId);
          }
        }).catch((error) => {
          console.error('[Network] Reconnection failed:', error);
        });
      }
    }, delay);
  }

  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.connected = false;
    this.playerId = null;
    this.roomId = null;
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
  }

  /**
   * Check if connected to server
   * @returns {boolean}
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get the current player ID
   * @returns {string|null}
   */
  getPlayerId() {
    return this.playerId;
  }

  /**
   * Get the current room ID
   * @returns {string|null}
   */
  getRoomId() {
    return this.roomId;
  }
}
