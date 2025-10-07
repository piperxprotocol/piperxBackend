import { BigInt, log } from "@graphprotocol/graph-ts";
import { Swap } from "../../generated/templates/UniswapV3Pool/UniswapV3Pool";
import { Token, TokenPair, TokenSwap, TokenPrice } from "../../generated/schema";
import { updateTokenPrices } from "../utils/token";

/**
 * Handle UniswapV3 Swap event
 * - Update token prices
 * - Record swap + price history
 */
export function handleV3Swap(event: Swap): void {
  const pairId = event.address.toHex();
  let pair = TokenPair.load(pairId);
  if (!pair) {
    log.warning("TokenPair not found for V3 swap: {}", [pairId]);
    return;
  }

  const token0 = Token.load(pair.token0);
  const token1 = Token.load(pair.token1);
  if (!token0 || !token1) {
    log.warning("Tokens not found for pair {}", [pairId]);
    return;
  }

  const token0Amount = event.params.amount0.abs();
  const token1Amount = event.params.amount1.abs();

  if (token0Amount.isZero() || token1Amount.isZero()) return;

  updateTokenPrices(token0, token1, token0Amount, token1Amount);
  updateTokenPrices(token1, token0, token1Amount, token0Amount);

  token0.save();
  token1.save();

  const swapId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  const swap = new TokenSwap(swapId);
  swap.timestamp = event.block.timestamp.toI64();
  swap.pair = pair.id;
  swap.token0Amount = token0Amount;
  swap.token1Amount = token1Amount;
  swap.save();

  const token0Price = new TokenPrice(swapId + "-0");
  token0Price.timestamp = event.block.timestamp.toI64();
  token0Price.token = token0.id;
  token0Price.priceUSD = token0.latestPriceUSD;
  token0Price.priceNative = token0.latestPriceNative;
  token0Price.save();

  const token1Price = new TokenPrice(swapId + "-1");
  token1Price.timestamp = event.block.timestamp.toI64();
  token1Price.token = token1.id;
  token1Price.priceUSD = token1.latestPriceUSD;
  token1Price.priceNative = token1.latestPriceNative;
  token1Price.save();

  log.info("✅ V3 Swap handled for pool: {}", [pairId]);
}
