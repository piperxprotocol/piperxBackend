import { Transfer } from "../../generated/templates/TokenTemplate/ERC20"
import { HolderBalance, Holder } from "../../generated/schema"
import { BigInt, BigDecimal } from "@graphprotocol/graph-ts"

const ZERO_BD = BigDecimal.fromString("0")
const ONE_BI = BigInt.fromI32(1)
const ZERO_ADDR = "0x0000000000000000000000000000000000000000"

function idFor(token: string, addr: string): string {
  return token + "-" + addr
}

function loadGlobal(token: string): Holder {
  let h = Holder.load(token)
  if (h == null) {
    h = new Holder(token)
    h.holderCount = BigInt.fromI32(0)
  }
  return h as Holder
}

export function handleTransfer(event: Transfer): void {
  let token = event.address.toHex().toLowerCase()
  let from = event.params.from.toHex().toLowerCase()
  let to = event.params.to.toHex().toLowerCase()
  let value = event.params.value.toBigDecimal()
  let global = loadGlobal(token)

  if (from != ZERO_ADDR) {
    let fromId = idFor(token, from)
    let sender = HolderBalance.load(fromId)
    if (sender == null) {
      sender = new HolderBalance(fromId)
      sender.token = event.address
      sender.address = event.params.from
      sender.balance = ZERO_BD
    }
    let wasPos = sender.balance.gt(ZERO_BD)
    sender.balance = sender.balance.minus(value)
    let nowPos = sender.balance.gt(ZERO_BD)
    if (wasPos && !nowPos) global.holderCount = global.holderCount.minus(ONE_BI)
    sender.save()
  }

  if (to != ZERO_ADDR) {
    let toId = idFor(token, to)
    let receiver = HolderBalance.load(toId)
    if (receiver == null) {
      receiver = new HolderBalance(toId)
      receiver.token = event.address
      receiver.address = event.params.to
      receiver.balance = ZERO_BD
    }
    let wasPos = receiver.balance.gt(ZERO_BD)
    receiver.balance = receiver.balance.plus(value)
    let nowPos = receiver.balance.gt(ZERO_BD)
    if (!wasPos && nowPos) global.holderCount = global.holderCount.plus(ONE_BI)
    receiver.save()
  }

  global.save()
}
