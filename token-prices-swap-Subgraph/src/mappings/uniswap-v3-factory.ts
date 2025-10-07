import { PoolCreated } from "../../generated/UniswapV3Factory/UniswapV3Factory";
import { TokenPair } from "../../generated/schema";
import { UniswapV3Pool as V3PoolTemplate } from "../../generated/templates";
import { BigInt, log } from "@graphprotocol/graph-ts";

/**
 * Handle UniswapV3 PoolCreated event
 * - Save TokenPair entity
 * - Dynamically start tracking Swap events for this pool
 */
export function handlePoolCreated(event: PoolCreated): void {
  const poolAddress = event.params.pool.toHex();
  log.info("🟣 New UniswapV3 Pool Created: {}", [poolAddress]);

  const tokenPair = new TokenPair(poolAddress);
  tokenPair.token0 = event.params.token0.toHex();
  tokenPair.token1 = event.params.token1.toHex();
  tokenPair.pool = poolAddress;
  tokenPair.save();

  // Dynamically create new data source for this pool
  V3PoolTemplate.create(event.params.pool);
}
