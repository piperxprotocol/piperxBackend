import { PairCreated } from "../../generated/UniswapV2Factory/UniswapV2Factory";
import { TokenPair } from "../../generated/schema";
import { UniswapV2Pair as V2PairTemplate } from "../../generated/templates";
import { BigInt, log } from "@graphprotocol/graph-ts";

/**
 * Handle UniswapV2 PairCreated event
 * - Save TokenPair entity
 * - Dynamically start tracking Swap events for this pair
 */
export function handlePairCreated(event: PairCreated): void {
  const pairAddress = event.params.pair.toHex();
  log.info("🟢 New UniswapV2 Pair Created: {}", [pairAddress]);

  // Create TokenPair entity
  const tokenPair = new TokenPair(pairAddress);
  tokenPair.token0 = event.params.token0.toHex();
  tokenPair.token1 = event.params.token1.toHex();
  tokenPair.pool = pairAddress;
  tokenPair.save();

  // Dynamically create new data source for this pair
  V2PairTemplate.create(event.params.pair);
}
