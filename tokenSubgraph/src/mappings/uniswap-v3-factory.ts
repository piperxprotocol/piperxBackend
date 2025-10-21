import { PoolCreated } from "../../generated/UniswapV3Factory/UniswapV3Factory"
import { ERC20 } from "../../generated/UniswapV3Factory/ERC20"
import { Token } from "../../generated/schema"
import { log, Address, BigInt } from "@graphprotocol/graph-ts"
import { TokenTemplate } from "../../generated/templates" 

function getSource(factory: Address): string {
  const addr = factory.toHexString().toLowerCase()
  if (addr == "0xb8c21e89983b5eccd841846ea294c4c8a89718f1") return "piperx"
  if (addr == "0xa111ddbe973094f949d78ad755cd560f8737b7e2") return "storyhunt"
  return "unknown"
}

function loadOrCreateToken(address: Address, timestamp: BigInt, source: string, pool: string): void {
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

export function handlePoolCreated(event: PoolCreated): void {
  const source = getSource(event.address)
  const pool = event.params.pool.toHexString()
  loadOrCreateToken(event.params.token0, event.block.timestamp, source, pool)
  loadOrCreateToken(event.params.token1, event.block.timestamp, source, pool)
}
