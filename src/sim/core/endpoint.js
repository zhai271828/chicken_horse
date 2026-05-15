import { GameConfig } from '../../config/GameConfig.js';
import { TileType } from '../../config/TileType.js';

export function playerTouchesEndpointTile(player, tiledMap, p) {
    if (!player || !tiledMap?.MAP || !p) return false;

    const tx = p.floor((player.x + player.w / 2) / GameConfig.TILE);
    const ty = p.floor((player.y + player.h / 2) / GameConfig.TILE);

    return Boolean(
        tiledMap.MAP[ty] &&
            tiledMap.MAP[ty][tx] === TileType.ENDPOINT,
    );
}

export function isPlayerNearEndpoint(player, tiledMap) {
    if (!player || !tiledMap) return false;

    const endX = tiledMap.endX ?? 0;
    const endY = tiledMap.endY ?? 0;
    const endW = tiledMap.endW || GameConfig.TILE;
    const endH = tiledMap.endH || GameConfig.TILE;
    const px = player.x + player.w / 2;
    const py = player.y + player.h / 2;
    const ex = endX + endW / 2;
    const ey = endY + endH / 2;
    const radius =
        (GameConfig.NEAR_FINISH_DEATH_RADIUS_TILES ?? 10) * GameConfig.TILE;
    const dx = px - ex;
    const dy = py - ey;

    return dx * dx + dy * dy <= radius * radius;
}
