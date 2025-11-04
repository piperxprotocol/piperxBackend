import { PairCreated } from "../../generated/UniswapV2Factory/UniswapV2Factory"
import { ERC20 } from "../../generated/UniswapV2Factory/ERC20"
import { Token } from "../../generated/schema"
import { log, Address, BigInt } from "@graphprotocol/graph-ts"
import { TokenTemplate } from "../../generated/templates" 

function loadOrCreateToken(address: Address, timestamp: BigInt,  source: string, pool: string): void {
  let id = address.toHexString()
  let token = Token.load(id)
  if (token != null) return

  let contract = ERC20.bind(address)
  let nameResult = contract.try_name()
  let symbolResult = contract.try_symbol()
  let decimalsResult = contract.try_decimals()

  token = new Token(id)
  token.name = nameResult.reverted ? "Unknown" : nameResult.value
  token.symbol = symbolResult.reverted ? "UNK" : symbolResult.value
  token.decimals = decimalsResult.reverted ? 18 : decimalsResult.value
  token.creator = "factory"
  token.createdAt = timestamp
  token.source = source
  token.pool = pool
  token.save()

  TokenTemplate.create(address)

  log.info("✅ New token created: {} ({})", [token.symbol, token.id])
}

export function handlePairCreated(event: PairCreated): void {
  const source = "piperx"
  const pool = event.params.pair.toHexString()
  loadOrCreateToken(event.params.token0, event.block.timestamp, source, pool)
  loadOrCreateToken(event.params.token1, event.block.timestamp, source, pool)
}
