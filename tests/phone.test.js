// Phone number cleaning. Run with: node --test tests/phone.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPhone } from "../src/util.js";

const ok = (raw, display) => { const p = cleanPhone(raw); assert.equal(p.valid, true, raw); assert.equal(p.display, display, raw); };
const bad = (raw) => assert.equal(cleanPhone(raw).valid, false, raw);

test("landlines", () => {
  ok("(08) 9332 9929", "08 9332 9929");
  ok("+61 8 9332 9929", "08 9332 9929");
  ok("+61 08 9332 9929", "08 9332 9929");
  ok("61893329929", "08 9332 9929");
  ok("9332 9929", "08 9332 9929");
  ok("6111 2222", "08 6111 2222");
  ok("02 9876 5432", "02 9876 5432");
});
test("mobiles", () => {
  ok("0432 365 630", "0432 365 630");
  ok("+61432365630", "0432 365 630");
  ok("+61 (0) 432 365 630", "0432 365 630");
});
test("business numbers", () => {
  ok("1300 123 456", "1300 123 456");
  ok("1800123456", "1800 123 456");
  ok("13 13 13", "13 13 13");
});
test("lists take the first valid number", () => {
  ok("08 9332 9929; 0432 365 630", "08 9332 9929");
  ok("123; 0432 365 630", "0432 365 630");
});
test("invalid numbers are flagged", () => {
  bad("1234"); bad("08 9332"); bad("+1 415 555 0100"); bad("0011 44 20 7946 0000"); bad("call us");
  assert.equal(cleanPhone("").display, "");
});
test("tel links use +61", () => {
  assert.equal(cleanPhone("08 9332 9929").tel, "tel:+61893329929");
  assert.equal(cleanPhone("13 13 13").tel, "tel:131313");
});

import { commissionFor, commissionTotal } from "../src/extras.js";
test("commission: $100 for $500+, 10% under $500", () => {
  assert.equal(commissionFor(500), 100);
  assert.equal(commissionFor(1200), 100);
  assert.equal(commissionFor(499), 49.9);
  assert.equal(commissionFor(300), 30);
  assert.equal(commissionFor(0), 0);
  assert.equal(commissionTotal([{ status: "Won", value: 800 }, { status: "Won", value: 250 }, { status: "Interested" }]), 125);
});
