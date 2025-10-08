import { BigInt, log, Address } from "@graphprotocol/graph-ts";
import { Token, Account } from "../../generated/schema";
import { IP_ADDRESS, PRICE_PRECISION, USDC_ADDRESS } from "./constants";

/**
 * Update tokenA price relative to tokenB
 * formula: priceA = (amountB / amountA) * priceB
 */
export function calculateTokenPriceThroughIntermediateUSD(
    token: Token,
    intermediateToken: Token,
    amount: BigInt,
    intermediateAmount: BigInt
  ): BigInt {
    if (intermediateToken.latestPriceUSD.notEqual(BigInt.fromI32(0))) {
      // Calculate through USD price
      return amount.times(intermediateToken.latestPriceUSD).div(intermediateAmount)
    }
    return BigInt.fromI32(0)
  }
  
  export function calculateTokenPriceThroughIntermediateNative(
    token: Token,
    intermediateToken: Token,
    amount: BigInt,
    intermediateAmount: BigInt
  ): BigInt {
    if (intermediateToken.latestPriceNative.notEqual(BigInt.fromI32(0))) {
      // Calculate through Native price
      return amount.times(intermediateToken.latestPriceNative).div(intermediateAmount)
    }
    return BigInt.fromI32(0)
  }
  
  export function getUSDCToNativePrice(): BigInt {
    const usdc = Token.load(USDC_ADDRESS)
    const ip = Token.load(IP_ADDRESS)
  
    // If either token doesn't exist, return PRICE_PRECISION as fallback
    if (!usdc || !ip) {
      return PRICE_PRECISION
    }
  
    // If USDC has a Native price, use it
    if (usdc.latestPriceNative.notEqual(BigInt.fromI32(0))) {
      return usdc.latestPriceNative
    }
  
    // // If IP has a USD price, calculate USDC's Native price
    // if (ip.latestPriceUSD.notEqual(BigInt.fromI32(0))) {
    //   // USDC's Native price = IP's USD price (since 1 USDC = 1 USD)
    //   return ip.latestPriceUSD
    // }
  
    return PRICE_PRECISION
  }
  
  export function updateTokenPrices(
    token: Token,
    pairedToken: Token,
    tokenAmount: BigInt,
    pairedTokenAmount: BigInt
  ): void {
    // Store current prices
    const currentUSDPrice = token.latestPriceUSD;
    const currentNativePrice = token.latestPriceNative;
  
    log.info(
      "Updating prices - Token: {} ({}), PairedToken: {} ({}), TokenAmount: {}, PairedAmount: {}, PairedUSD: {}, PairedNative: {}, CurrentUSD: {}, CurrentNative: {}",
      [
        token.id,
        token.symbol,
        pairedToken.id,
        pairedToken.symbol,
        tokenAmount.toString(),
        pairedTokenAmount.toString(),
        pairedToken.latestPriceUSD.toString(),
        pairedToken.latestPriceNative.toString(),
        currentUSDPrice.toString(),
        currentNativePrice.toString()
      ]
    );
  
    // If this is USDC, update its prices based on IP's prices
    if (token.id == USDC_ADDRESS) {
      if (pairedToken.id == IP_ADDRESS) {
        // USDC's USD price is always PRICE_PRECISION (1 USD)
        token.latestPriceUSD = PRICE_PRECISION
        // USDC's Native price is equal to IP's USD price
        token.latestPriceNative = pairedTokenAmount.times(PRICE_PRECISION).div(tokenAmount)
        // pairedToken.latestPriceNative = PRICE_PRECISION
        // pairedToken.latestPriceUSD = tokenAmount.times(PRICE_PRECISION).div(pairedTokenAmount)
      } else {
        token.latestPriceUSD = PRICE_PRECISION
      }
      return
    }
  
    // If this is IP, update its prices
    if (token.id == IP_ADDRESS) {
      if (pairedToken.id == USDC_ADDRESS) {
        const priceUSD = pairedTokenAmount.times(PRICE_PRECISION).div(tokenAmount)
        token.latestPriceUSD = priceUSD
        // IP's Native price is always PRICE_PRECISION
        token.latestPriceNative = PRICE_PRECISION
        // Update USDC's Native price to match IP's USD price
        // pairedToken.latestPriceUSD = PRICE_PRECISION
        // pairedToken.latestPriceNative = tokenAmount.times(PRICE_PRECISION).div(pairedTokenAmount)
      } else {
        token.latestPriceNative = PRICE_PRECISION
      }
      return
    }
  
    // If paired token has Native price, calculate token's Native price
    if (pairedToken.latestPriceNative.notEqual(BigInt.fromI32(0))) {
      const priceNative = calculateTokenPriceThroughIntermediateNative(
        token,
        pairedToken,
        pairedTokenAmount,
        tokenAmount
      )
      if (priceNative.notEqual(BigInt.fromI32(0))) {
        token.latestPriceNative = priceNative
  
        // If this is USDC, set its USD price to PRICE_PRECISION
        if (token.id == USDC_ADDRESS) {
          token.latestPriceUSD = PRICE_PRECISION
        } else {
          // Calculate USD price if we have USDC to Native price
          const usdcToNative = getUSDCToNativePrice()
          if (usdcToNative.notEqual(BigInt.fromI32(0))) {
            token.latestPriceUSD = priceNative.times(PRICE_PRECISION).div(usdcToNative)
          }
        }
      }
    }
    // For other tokens, calculate prices normally
    else if (pairedToken.latestPriceUSD.notEqual(BigInt.fromI32(0))) {
      const priceUSD = calculateTokenPriceThroughIntermediateUSD(
        token,
        pairedToken,
        pairedTokenAmount,
        tokenAmount
      )
      if (priceUSD.notEqual(BigInt.fromI32(0))) {
        token.latestPriceUSD = priceUSD
  
        // If this is IP, set its Native price to PRICE_PRECISION
        if (token.id == IP_ADDRESS) {
          token.latestPriceNative = PRICE_PRECISION
        } else {
          // Calculate native price if we have USDC to Native price
          const usdcToNative = getUSDCToNativePrice()
          if (usdcToNative.notEqual(BigInt.fromI32(0))) {
            token.latestPriceNative = priceUSD.times(usdcToNative).div(PRICE_PRECISION)
          }
        }
      }
    }
  
  
    // Add logging after price update
    log.info(
      "Updated token prices - Token: {} ({}), USD: {}, Native: {}",
      [
        token.id,
        token.symbol,
        token.latestPriceUSD.toString(),
        token.latestPriceNative.toString()
      ]
    );
  }
  