# Processing rules

## Coverage

- **Sessions:** 19, from 2026-10-27 to 2026-10-27.
- **Distinct layer + API combinations:** 32. **Distinct EAI SvcCode combinations:** 4 (FT01 ~ A01; ACCT ~ INQ01 | ACCT ~ BAL02 | ACCT ~ LMT03; CIF1 ~ PRF01; FT01 ~ A01 | FT01 ~ A02).

| Phase 5 scenario | Covered by | Sessions |
|---|---|---|
| A: eComm internal processing only | 000000000001, 000000000011, 000000000018 | 3 |
| B: eComm → one Enterprise API, Enterprise internal | 000000000002, 000000000010, 000000000016, 000000000017, 000000000019 | 5 |
| C: eComm → several Enterprise APIs | 000000000003, 000000000014, 000000000015 | 3 |
| D: EAI service with one sub-service | 000000000004, 000000000006, 000000000007, 000000000008, 000000000012, 000000000013 | 6 |
| E: EAI service with several sub-services | 000000000005, 000000000009 | 2 |
| F: EAI plus direct downstream (OPI, WAM, CUS…) | 000000000006 | 1 |
| G1: Timeout or missing response | 000000000007, 000000000008 | 2 |
| G2: EAI returns an error | 000000000009 | 1 |
| G3: Enterprise HTTP 200 with business error | 000000000007, 000000000009, 000000000010, 000000000014, 000000000015, 000000000016 | 6 |
| G4: eComm non-success code with description | 000000000007, 000000000009, 000000000010, 000000000011, 000000000015, 000000000018 | 6 |
| H: Sessions interleaved in time | 000000000012, 000000000013 | 2 |
| I: One Enterprise call succeeds, another fails | 000000000014, 000000000015 | 2 |

## 1. Routing rules

Condition comes from the caller's request JSON: a field whose value is the same in every call that took this route and different in all the others. Fields that differ in every call (IDs) are ignored.

| Caller | Condition | Observed action | Evidence sessions | Confidence |
|---|---|---|---|---|
| eComm activateCard | always (every observed call) | call 1 Enterprise API: CardActivation | 1 | low (single sample) |
| eComm fundTransfer | always (every observed call) | call 1 Enterprise API: FundTransfer | 6 | high |
| eComm getAccountDetails | always (every observed call) | call 1 Enterprise API: AccountInquiry | 1 | low (single sample) |
| eComm getAccountList | always (every observed call) | call 1 Enterprise API: AccountList | 1 | low (single sample) |
| eComm getCustomer360 | always (every observed call) | call 1 Enterprise API: Customer360 | 1 | low (single sample) |
| eComm getDashboard | unknown: no request field separates the variants | call 3 Enterprise APIs: CustomerProfile → AccountSummary → RewardsBalance | 1 | low (single sample) |
| eComm getDashboard | unknown: no request field separates the variants | call 2 Enterprise APIs: AccountSummary → RewardsBalance | 2 | medium |
| eComm getLimits | always (every observed call) | call 1 Enterprise API: LimitInquiry | 1 | low (single sample) |
| eComm getLoanQuote | always (every observed call) | call 1 Enterprise API: LoanQuote | 1 | low (single sample) |
| eComm getProfile | always (every observed call) | internal process | 1 | low (single sample) |
| eComm getStatements | always (every observed call) | internal process | 1 | low (single sample) |
| eComm payBill | always (every observed call) | call 1 Enterprise API: BillPayment | 1 | low (single sample) |
| eComm validatePayee | always (every observed call) | internal process | 1 | low (single sample) |
| Enterprise AccountInquiry | always (every observed call) | via WS /ws/account/inquiry; call EAI ACCT ~ INQ01 \| ACCT ~ BAL02 \| ACCT ~ LMT03 | 1 | low (single sample) |
| Enterprise AccountList | always (every observed call) | internal process | 1 | low (single sample) |
| Enterprise AccountSummary | always (every observed call) | internal process | 3 | high |
| Enterprise BillPayment | always (every observed call) | internal process | 1 | low (single sample) |
| Enterprise CardActivation | always (every observed call) | internal process | 1 | low (single sample) |
| Enterprise Customer360 | always (every observed call) | via WS /ws/customer/360; call EAI CIF1 ~ PRF01; call downstream OPI /opi/v2/customer/profile; call downstream WAM /wam/v1/limits; call downstream CUS /cus/v1/customer/segment | 1 | low (single sample) |
| Enterprise CustomerProfile | always (every observed call) | internal process | 1 | low (single sample) |
| Enterprise FundTransfer | unknown: no request field separates the variants | via WS /ws/fund/transfer; call EAI FT01 ~ A01 | 5 | high |
| Enterprise FundTransfer | unknown: no request field separates the variants | via WS /ws/fund/transfer; call EAI FT01 ~ A01 \| FT01 ~ A02 | 1 | low (single sample) |
| Enterprise LimitInquiry | always (every observed call) | internal process | 1 | low (single sample) |
| Enterprise LoanQuote | always (every observed call) | internal process | 1 | low (single sample) |
| Enterprise RewardsBalance | always (every observed call) | internal process | 3 | high |

## 2. EAI and downstream mapping

| Enterprise endpoint | EAI SvcCode | Downstream system | Direction | Evidence | Flag |
|---|---|---|---|---|---|
| FundTransfer | FT01 ~ A01 | not logged | request + response / request only | 5 session(s) | ⚑ SvcCode with no downstream log (system behind EAI not logged or not mapped) |
| AccountInquiry | ACCT ~ INQ01 \| ACCT ~ BAL02 \| ACCT ~ LMT03 | not logged | request + response | 1 session(s) | ⚑ SvcCode with no downstream log (system behind EAI not logged or not mapped) |
| Customer360 | CIF1 ~ PRF01 | not logged | request + response | 1 session(s) | ⚑ SvcCode with no downstream log (system behind EAI not logged or not mapped) |
| Customer360 | — | OPI (/opi/v2/customer/profile) | request + response | 1 session(s) | ⚑ downstream log with no SvcCode (direct call, not via EAI) |
| Customer360 | — | WAM (/wam/v1/limits) | request + response | 1 session(s) | ⚑ downstream log with no SvcCode (direct call, not via EAI) |
| Customer360 | — | CUS (/cus/v1/customer/segment) | request + response | 1 session(s) | ⚑ downstream log with no SvcCode (direct call, not via EAI) |
| FundTransfer | FT01 ~ A01 \| FT01 ~ A02 | not logged | request + response | 1 session(s) | ⚑ SvcCode with no downstream log (system behind EAI not logged or not mapped) |

## 3. Sequence and dependency

A pair of calls is **sequential** when the next request is logged at or after the previous response, and **overlapping** only when it is logged before that response. Calls that merely sit close together in time are not counted as parallel. **Undetermined** means the previous call has no response to compare with. A child that appears in only some calls of the same caller is **conditional**.

| Caller | Calls | Verdict | Pairs seq / overlap / undetermined | Conditional children | Example (EventTime, ElapsedMs) |
|---|---|---|---|---|---|
| eComm getDashboard | 3 | sequential | 4 / 0 / 0 | Enterprise CustomerProfile in 1 of 3 | Enterprise CustomerProfile: request 2026-10-27 01:15:05.206, response 2026-10-27 01:15:05.249 (ElapsedMs 43); next Enterprise AccountSummary request 2026-10-27 01:15:05.253 → gap 4 ms |
| WS /ws/fund/transfer | 6 | one call each time | 0 / 0 / 0 | EAI FT01 ~ A01 in 5 of 6; EAI FT01 ~ A01 \| FT01 ~ A02 in 1 of 6 | — |
| WS /ws/customer/360 | 1 | sequential | 3 / 0 / 0 | — | EAI CIF1 ~ PRF01: request 2026-10-27 01:15:10.407, response 2026-10-27 01:15:10.566 (ElapsedMs 159); next OPI /opi/v2/customer/profile request 2026-10-27 01:15:10.569 → gap 3 ms |

## 4. Failure handling

Failure point = the earliest hop that failed or never got a response (a missing response is placed at its request time, so a timeout shows up at the hop that went silent).

| Session | Failure point | Error signal | Retry observed | Fallback observed | Final caller response |
|---|---|---|---|---|---|
| 000000000007 | EAI FT01 ~ A01 (step 4) | no response logged; caller reported "504 EAI timeout after 30000 ms" | no | no | 9001 FAILED "Service temporarily unavailable" |
| 000000000008 | EAI FT01 ~ A01 (step 4) | no response logged | no | no | no response |
| 000000000009 | EAI FT01 ~ A01 \| FT01 ~ A02 (step 4) | RespCode 0,E102 | no | no | 1020 FAILED "Transfer could not be completed" |
| 000000000010 | Enterprise BillPayment (step 2) | ErrCode E2001, "Insufficient balance", HTTP 200 | no | no | 2001 FAILED "Insufficient balance" |
| 000000000011 | eComm validatePayee (step 1) | RespCode 1001, "Invalid payee account", HTTP 200 | no | no | 1001 FAILED "Invalid payee account" |
| 000000000014 | Enterprise RewardsBalance (step 4) | ErrCode E3001, "Rewards service unavailable", HTTP 200 | no | no | 0000 SUCCESS |
| 000000000015 | Enterprise RewardsBalance (step 4) | ErrCode E3001, "Rewards service unavailable", HTTP 200 | no | no | 3001 FAILED "Dashboard partially unavailable" |
| 000000000016 | Enterprise CardActivation (step 2) | ErrCode E4005, HTTP 200 | no | no | 4005 FAILED |
| 000000000017 | Enterprise LoanQuote (step 2) | HTTP 503 | no | no | 5003 FAILED |
| 000000000018 | eComm getStatements (step 1) | RespCode 0000, "Older statements temporarily unavailable", HTTP 200 | no | no | 0000 FAILED "Older statements temporarily unavailable" |

## 5. Data propagation

**sessionId in the raw log, by layer:**

| Layer | Carries sessionId | Linked through LinkKey | Not linked |
|---|---|---|---|
| eComm | 37 | 0 | 0 |
| Enterprise | 39 | 0 | 0 |
| WS | 21 | 0 | 0 |
| Host | 0 | 14 | 0 |

**transactionRef from caller to callee:**

| Edge | Observed | Sessions |
|---|---|---|
| eComm → Enterprise | new value generated | 16 |
| Enterprise → WS | same value | 8 |
| WS → Host | same value, renamed to the Host link tag (<RqUID>…</RqUID>) | 8 |
| WS → OPI | same value | 1 |
| WS → WAM | same value | 1 |
| WS → CUS | same value | 1 |

**eComm request fields, followed down the call tree:**

| Field | Into layer | Observed | Sessions |
|---|---|---|---|
| data.customerId | Enterprise | not passed on | 16 |
| data.customerId | WS | not passed on | 8 |
| data.customerId | Host | not passed on | 8 |
| data.customerId | OPI | not passed on | 1 |
| data.customerId | WAM | not passed on | 1 |
| data.customerId | CUS | not passed on | 1 |

## 6. Latency baseline (ElapsedMs)

| Endpoint | n | Min | Median | Max | Outliers |
|---|---|---|---|---|---|
| CUS /cus/v1/customer/segment | 1 | 33 | 33 | 33 | n < 3: no outlier test |
| Enterprise AccountInquiry | 1 | 277 | 277 | 277 | n < 3: no outlier test |
| Enterprise AccountList | 1 | 50 | 50 | 50 | n < 3: no outlier test |
| Enterprise AccountSummary | 3 | 53 | 56 | 57 | none |
| Enterprise BillPayment | 1 | 38 | 38 | 38 | n < 3: no outlier test |
| Enterprise CardActivation | 1 | 34 | 34 | 34 | n < 3: no outlier test |
| Enterprise Customer360 | 1 | 345 | 345 | 345 | n < 3: no outlier test |
| Enterprise CustomerProfile | 1 | 43 | 43 | 43 | n < 3: no outlier test |
| Enterprise FundTransfer | 5 | 214 | 229 | 30020 | 1 outlier(s) |
| Enterprise LimitInquiry | 1 | 30 | 30 | 30 | n < 3: no outlier test |
| Enterprise LoanQuote | 1 | 20 | 20 | 20 | n < 3: no outlier test |
| Enterprise RewardsBalance | 3 | 27 | 29 | 32 | none |
| Host ACCT | 1 | 244 | 244 | 244 | n < 3: no outlier test |
| Host CIF1 | 1 | 159 | 159 | 159 | n < 3: no outlier test |
| Host FT01 | 4 | 176 | 189 | 213 | none |
| OPI /opi/v2/customer/profile | 1 | 68 | 68 | 68 | n < 3: no outlier test |
| WAM /wam/v1/limits | 1 | 45 | 45 | 45 | n < 3: no outlier test |
| WS /ws/account/inquiry | 1 | 261 | 261 | 261 | n < 3: no outlier test |
| WS /ws/customer/360 | 1 | 328 | 328 | 328 | n < 3: no outlier test |
| WS /ws/fund/transfer | 5 | 196 | 211 | 30005 | 1 outlier(s) |
| eComm activateCard | 1 | 48 | 48 | 48 | n < 3: no outlier test |
| eComm fundTransfer | 5 | 229 | 244 | 30033 | 1 outlier(s) |
| eComm getAccountDetails | 1 | 292 | 292 | 292 | n < 3: no outlier test |
| eComm getAccountList | 1 | 66 | 66 | 66 | n < 3: no outlier test |
| eComm getCustomer360 | 1 | 360 | 360 | 360 | n < 3: no outlier test |
| eComm getDashboard | 3 | 100 | 105 | 157 | none |
| eComm getLimits | 1 | 30 | 30 | 30 | n < 3: no outlier test |
| eComm getLoanQuote | 1 | 33 | 33 | 33 | n < 3: no outlier test |
| eComm getProfile | 1 | 18 | 18 | 18 | n < 3: no outlier test |
| eComm getStatements | 1 | 27 | 27 | 27 | n < 3: no outlier test |
| eComm payBill | 1 | 51 | 51 | 51 | n < 3: no outlier test |
| eComm validatePayee | 1 | 20 | 20 | 20 | n < 3: no outlier test |

- Enterprise FundTransfer in session `000000000007`: 30020 ms vs median 229 ms. **Correlates with a failure** (FAILED).
- WS /ws/fund/transfer in session `000000000007`: 30005 ms vs median 211 ms. **Correlates with a failure** (FAILED).
- eComm fundTransfer in session `000000000007`: 30033 ms vs median 244 ms. **Correlates with a failure** (FAILED).

## 7. Success and failure patterns

**Failure rate** = FAILED responses ÷ all responses. Requests that never got a response are counted separately.

| Endpoint | Responses | FAILED | Failure rate | No response | UNKNOWN |
|---|---|---|---|---|---|
| CUS /cus/v1/customer/segment | 1 | 0 | 0% | 0 | 0 |
| Enterprise AccountInquiry | 1 | 0 | 0% | 0 | 0 |
| Enterprise AccountList | 1 | 0 | 0% | 0 | 0 |
| Enterprise AccountSummary | 3 | 0 | 0% | 0 | 0 |
| Enterprise BillPayment | 1 | 1 | 100% | 0 | 0 |
| Enterprise CardActivation | 1 | 1 | 100% | 0 | 0 |
| Enterprise Customer360 | 1 | 0 | 0% | 0 | 0 |
| Enterprise CustomerProfile | 1 | 0 | 0% | 0 | 0 |
| Enterprise FundTransfer | 5 | 2 | 40% | 1 | 0 |
| Enterprise LimitInquiry | 1 | 0 | 0% | 0 | 0 |
| Enterprise LoanQuote | 1 | 1 | 100% | 0 | 0 |
| Enterprise RewardsBalance | 3 | 2 | 67% | 0 | 0 |
| Host ACCT | 1 | 0 | 0% | 0 | 0 |
| Host CIF1 | 1 | 0 | 0% | 0 | 0 |
| Host FT01 | 4 | 1 | 25% | 2 | 0 |
| OPI /opi/v2/customer/profile | 1 | 0 | 0% | 0 | 0 |
| WAM /wam/v1/limits | 1 | 0 | 0% | 0 | 0 |
| WS /ws/account/inquiry | 1 | 0 | 0% | 0 | 0 |
| WS /ws/customer/360 | 1 | 0 | 0% | 0 | 0 |
| WS /ws/fund/transfer | 5 | 1 | 20% | 1 | 0 |
| eComm activateCard | 1 | 1 | 100% | 0 | 0 |
| eComm fundTransfer | 5 | 2 | 40% | 1 | 0 |
| eComm getAccountDetails | 1 | 0 | 0% | 0 | 0 |
| eComm getAccountList | 1 | 0 | 0% | 0 | 0 |
| eComm getCustomer360 | 1 | 0 | 0% | 0 | 0 |
| eComm getDashboard | 3 | 1 | 33% | 0 | 0 |
| eComm getLimits | 1 | 0 | 0% | 0 | 0 |
| eComm getLoanQuote | 1 | 1 | 100% | 0 | 0 |
| eComm getProfile | 1 | 0 | 0% | 0 | 0 |
| eComm getStatements | 1 | 1 | 100% | 0 | 0 |
| eComm payBill | 1 | 1 | 100% | 0 | 0 |
| eComm validatePayee | 1 | 1 | 100% | 0 | 0 |

**Error code taxonomy** (deepest layer first, which is usually where the code originates):

| Code | Field | Layers | Deepest layer | Count | Meaning |
|---|---|---|---|---|---|
| E102 | RespCode | Host | Host | 1 | not inferable: no description |
| 504 | RespCode | WS | WS | 1 | Gateway Timeout (standard HTTP meaning, if this is an HTTP status) |
| 503 | HTTP status (log) | Enterprise | Enterprise | 1 | Service Unavailable (standard HTTP meaning, if this is an HTTP status) |
| E1020 | ErrCode | Enterprise | Enterprise | 1 | "Debit leg failed at host" (from ErrDesc) |
| E2001 | ErrCode | Enterprise | Enterprise | 1 | "Insufficient balance" (from ErrDesc) |
| E3001 | ErrCode | Enterprise | Enterprise | 2 | "Rewards service unavailable" (from ErrDesc) |
| E4005 | ErrCode | Enterprise | Enterprise | 1 | not inferable: no description |
| E9001 | ErrCode | Enterprise | Enterprise | 1 | "Downstream EAI timeout" (from ErrDesc) |
| 1001 | RespCode | eComm | eComm | 1 | "Invalid payee account" (from ErrDesc) |
| 1020 | RespCode | eComm | eComm | 1 | "Transfer could not be completed" (from ErrDesc) |
| 2001 | RespCode | eComm | eComm | 1 | "Insufficient balance" (from ErrDesc) |
| 3001 | RespCode | eComm | eComm | 1 | "Dashboard partially unavailable" (from ErrDesc) |
| 4005 | RespCode | eComm | eComm | 1 | not inferable: no description |
| 5003 | RespCode | eComm | eComm | 1 | not inferable: no description |
| 9001 | RespCode | eComm | eComm | 1 | "Service temporarily unavailable" (from ErrDesc) |

**Failure propagation** (from the failure point up to the app):

- `000000000007`: EAI FT01 ~ A01: **no response** → WS /ws/fund/transfer: **504** _(timeout surfaced as 504)_ → Enterprise FundTransfer: **E9001** _(different code (504 → E9001))_ → eComm fundTransfer: **9001** _(wrapped: same number, new prefix (E9001 → 9001))_
- `000000000008`: EAI FT01 ~ A01: **no response** → WS /ws/fund/transfer: **no response** _(caller did not respond either)_ → Enterprise FundTransfer: **no response** _(caller did not respond either)_ → eComm fundTransfer: **no response** _(caller did not respond either)_
- `000000000009`: EAI FT01 ~ A01 | FT01 ~ A02: **E102** → WS /ws/fund/transfer: **SUCCESS** _(reported SUCCESS despite the failure below)_ → Enterprise FundTransfer: **E1020** _(different code (E102 → E1020))_ → eComm fundTransfer: **1020** _(wrapped: same number, new prefix (E1020 → 1020))_
- `000000000010`: Enterprise BillPayment: **E2001** → eComm payBill: **2001** _(wrapped: same number, new prefix (E2001 → 2001))_
- `000000000011`: eComm validatePayee: **1001**
- `000000000014`: Enterprise RewardsBalance: **E3001** → eComm getDashboard: **SUCCESS** _(absorbed: the caller still succeeded)_
- `000000000015`: Enterprise RewardsBalance: **E3001** → eComm getDashboard: **3001** _(wrapped: same number, new prefix (E3001 → 3001))_
- `000000000016`: Enterprise CardActivation: **E4005** → eComm activateCard: **4005** _(wrapped: same number, new prefix (E4005 → 4005))_
- `000000000017`: Enterprise LoanQuote: **HTTP 503** → eComm getLoanQuote: **5003** _(different code (HTTP 503 → 5003))_
- `000000000018`: eComm getStatements: **FAILED**

**Retries:**

_No endpoint was called again after a failure in the same caller._

**PlantUML labels for each error** (use in the sequence diagram notes):

| Code | Label |
|---|---|
| 9001 | `eComm fundTransfer\n9001 Service temporarily unavailable` |
| E9001 | `Enterprise FundTransfer\nE9001 Downstream EAI timeout` |
| 504 | `WS /ws/fund/transfer\n504` |
| 1020 | `eComm fundTransfer\n1020 Transfer could not be completed` |
| E1020 | `Enterprise FundTransfer\nE1020 Debit leg failed at host` |
| E102 | `EAI FT01 ~ A01 \| FT01 ~ A02\nE102` |
| 2001 | `eComm payBill\n2001 Insufficient balance` |
| E2001 | `Enterprise BillPayment\nE2001 Insufficient balance` |
| 1001 | `eComm validatePayee\n1001 Invalid payee account` |
| E3001 | `Enterprise RewardsBalance\nE3001 Rewards service unavailable` |
| 3001 | `eComm getDashboard\n3001 Dashboard partially unavailable` |
| 4005 | `eComm activateCard\n4005` |
| E4005 | `Enterprise CardActivation\nE4005` |
| 5003 | `eComm getLoanQuote\n5003` |
| 503 | `Enterprise LoanQuote\n503` |

## 8. Rule confidence and gaps

**Confirmed by several sessions:**

- eComm fundTransfer: call 1 Enterprise API: FundTransfer (6 sessions)
- Enterprise AccountSummary: internal process (3 sessions)
- Enterprise RewardsBalance: internal process (3 sessions)
- transactionRef on eComm → Enterprise: new value generated (16 session(s))
- transactionRef on Enterprise → WS: same value (8 session(s))
- transactionRef on WS → Host: same value, renamed to the Host link tag (<RqUID>…</RqUID>) (8 session(s))

**Single-sample observations:**

- eComm activateCard: call 1 Enterprise API: CardActivation (1 session)
- eComm getAccountDetails: call 1 Enterprise API: AccountInquiry (1 session)
- eComm getAccountList: call 1 Enterprise API: AccountList (1 session)
- eComm getCustomer360: call 1 Enterprise API: Customer360 (1 session)
- eComm getLimits: call 1 Enterprise API: LimitInquiry (1 session)
- eComm getLoanQuote: call 1 Enterprise API: LoanQuote (1 session)
- eComm getProfile: internal process (1 session)
- eComm getStatements: internal process (1 session)
- eComm payBill: call 1 Enterprise API: BillPayment (1 session)
- eComm validatePayee: internal process (1 session)
- Enterprise AccountInquiry: via WS /ws/account/inquiry; call EAI ACCT ~ INQ01 | ACCT ~ BAL02 | ACCT ~ LMT03 (1 session)
- Enterprise AccountList: internal process (1 session)
- Enterprise BillPayment: internal process (1 session)
- Enterprise CardActivation: internal process (1 session)
- Enterprise Customer360: via WS /ws/customer/360; call EAI CIF1 ~ PRF01; call downstream OPI /opi/v2/customer/profile; call downstream WAM /wam/v1/limits; call downstream CUS /cus/v1/customer/segment (1 session)
- Enterprise CustomerProfile: internal process (1 session)
- Enterprise LimitInquiry: internal process (1 session)
- Enterprise LoanQuote: internal process (1 session)
- transactionRef on WS → OPI: same value (1 session(s))
- transactionRef on WS → WAM: same value (1 session(s))
- transactionRef on WS → CUS: same value (1 session(s))

**Inferred but unverified:**

- eComm getProfile: "internal process" means no downstream call was logged; the processing itself is not visible.
- eComm getStatements: "internal process" means no downstream call was logged; the processing itself is not visible.
- eComm validatePayee: "internal process" means no downstream call was logged; the processing itself is not visible.
- Enterprise AccountList: "internal process" means no downstream call was logged; the processing itself is not visible.
- Enterprise AccountSummary: "internal process" means no downstream call was logged; the processing itself is not visible.
- Enterprise BillPayment: "internal process" means no downstream call was logged; the processing itself is not visible.
- Enterprise CardActivation: "internal process" means no downstream call was logged; the processing itself is not visible.
- Enterprise CustomerProfile: "internal process" means no downstream call was logged; the processing itself is not visible.
- Enterprise LimitInquiry: "internal process" means no downstream call was logged; the processing itself is not visible.
- Enterprise LoanQuote: "internal process" means no downstream call was logged; the processing itself is not visible.
- Enterprise RewardsBalance: "internal process" means no downstream call was logged; the processing itself is not visible.
- WS is drawn as Enterprise calling its own web service (Phase 0 Q8 not yet confirmed).
- Systems behind EAI (BWC, ICH, …) are not visible in the logs; SvcCode → system mapping comes from config, if given.
- Downstream system names come from WS URL prefixes in the config.

**Contradicted or unexplained:**

- eComm getDashboard: when unknown: no request field separates the variants, call 3 Enterprise APIs: CustomerProfile → AccountSummary → RewardsBalance (1 session). Same caller, different actions, and no request field explains it.
- eComm getDashboard: when unknown: no request field separates the variants, call 2 Enterprise APIs: AccountSummary → RewardsBalance (2 sessions). Same caller, different actions, and no request field explains it.
- Enterprise FundTransfer: when unknown: no request field separates the variants, via WS /ws/fund/transfer; call EAI FT01 ~ A01 (5 sessions). Same caller, different actions, and no request field explains it.
- Enterprise FundTransfer: when unknown: no request field separates the variants, via WS /ws/fund/transfer; call EAI FT01 ~ A01 | FT01 ~ A02 (1 session). Same caller, different actions, and no request field explains it.

**What would close the gaps:**

- eComm activateCard → call 1 Enterprise API: CardActivation: seen once; one more session would confirm it.
- eComm getAccountDetails → call 1 Enterprise API: AccountInquiry: seen once; one more session would confirm it.
- eComm getAccountList → call 1 Enterprise API: AccountList: seen once; one more session would confirm it.
- eComm getCustomer360 → call 1 Enterprise API: Customer360: seen once; one more session would confirm it.
- eComm getDashboard → call 3 Enterprise APIs: CustomerProfile → AccountSummary → RewardsBalance: seen once; one more session would confirm it.
- eComm getLimits → call 1 Enterprise API: LimitInquiry: seen once; one more session would confirm it.
- eComm getLoanQuote → call 1 Enterprise API: LoanQuote: seen once; one more session would confirm it.
- eComm getProfile → internal process: seen once; one more session would confirm it.
- eComm getStatements → internal process: seen once; one more session would confirm it.
- eComm payBill → call 1 Enterprise API: BillPayment: seen once; one more session would confirm it.
- eComm validatePayee → internal process: seen once; one more session would confirm it.
- Enterprise AccountInquiry → via WS /ws/account/inquiry; call EAI ACCT ~ INQ01 | ACCT ~ BAL02 | ACCT ~ LMT03: seen once; one more session would confirm it.
- Enterprise AccountList → internal process: seen once; one more session would confirm it.
- Enterprise BillPayment → internal process: seen once; one more session would confirm it.
- Enterprise CardActivation → internal process: seen once; one more session would confirm it.
- Enterprise Customer360 → via WS /ws/customer/360; call EAI CIF1 ~ PRF01; call downstream OPI /opi/v2/customer/profile; call downstream WAM /wam/v1/limits; call downstream CUS /cus/v1/customer/segment: seen once; one more session would confirm it.
- Enterprise CustomerProfile → internal process: seen once; one more session would confirm it.
- Enterprise FundTransfer → via WS /ws/fund/transfer; call EAI FT01 ~ A01 | FT01 ~ A02: seen once; one more session would confirm it.
- Enterprise LimitInquiry → internal process: seen once; one more session would confirm it.
- Enterprise LoanQuote → internal process: seen once; one more session would confirm it.
- eComm getDashboard: the request fields logged don't explain the different routes. Add the deciding field (product, channel, customer segment…) to the log or the export.
- Enterprise FundTransfer: the request fields logged don't explain the different routes. Add the deciding field (product, channel, customer segment…) to the log or the export.
- SvcCode → backend system (BWC, ICH, …): give the mapping in the config (`svcSystems`), or include the backend logs.
- Latency baselines with fewer than 3 samples (25 endpoint(s)): more sessions per endpoint are needed before calling anything an outlier.
