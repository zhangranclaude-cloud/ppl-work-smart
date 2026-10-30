# Processing rules

## Coverage

- **Sessions:** 5, from 2026-10-27 to 2026-10-27.
- **Distinct layer + API combinations:** 18. **Distinct EAI SvcCode combinations:** 4 (ACCT ~ INQ01 | ACCT ~ BAL02 | ACCT ~ LMT03; CIF1 ~ PRF01; FT01 ~ A01; FT01 ~ A01 | FT01 ~ A02).

| Phase 5 scenario | Covered by | Sessions |
|---|---|---|
| A: eComm internal processing only | **missing** | 0 |
| B: eComm → one Enterprise API, Enterprise internal | **missing** | 0 |
| C: eComm → several Enterprise APIs | 000000000014 | 1 |
| D: EAI service with one sub-service | 000000000006, 000000000007 | 2 |
| E: EAI service with several sub-services | 000000000005, 000000000009 | 2 |
| F: EAI plus direct downstream (OPI, WAM, CUS…) | 000000000006 | 1 |
| G1: Timeout or missing response | 000000000007, 000000000009 | 2 |
| G2: EAI returns an error | 000000000009 | 1 |
| G3: Enterprise HTTP 200 with business error | 000000000009, 000000000014 | 2 |
| G4: eComm non-success code with description | 000000000007, 000000000009 | 2 |
| H: Sessions interleaved in time | 000000000006, 000000000007 | 2 |
| I: One Enterprise call succeeds, another fails | 000000000014 | 1 |

## 1. Routing rules

Condition comes from the caller's request JSON: a field whose value is the same in every call that took this route and different in all the others. Fields that differ in every call (IDs) are ignored.

| Caller | Condition | Observed action | Evidence sessions | Confidence |
|---|---|---|---|---|
| eComm fundTransfer | always (every observed call) | call 1 Enterprise API: FundTransfer | 2 | medium |
| eComm getAccountDetails | always (every observed call) | call 1 Enterprise API: AccountInquiry | 1 | low (single sample) |
| eComm getCustomer360 | always (every observed call) | call 1 Enterprise API: Customer360 | 1 | low (single sample) |
| eComm getDashboard | always (every observed call) | call 2 Enterprise APIs: AccountSummary → RewardsBalance | 1 | low (single sample) |
| Enterprise AccountInquiry | always (every observed call) | via WS /ws/account/inquiry; call EAI ACCT ~ INQ01 \| ACCT ~ BAL02 \| ACCT ~ LMT03 | 1 | low (single sample) |
| Enterprise AccountSummary | always (every observed call) | internal process | 1 | low (single sample) |
| Enterprise Customer360 | always (every observed call) | via WS /ws/customer/360; call EAI CIF1 ~ PRF01; call downstream OPI /opi/v2/customer/profile; call downstream WAM /wam/v1/limits; call downstream CUS /cus/v1/customer/segment | 1 | low (single sample) |
| Enterprise FundTransfer | data.accountNo = FAKE-ACCT-0007 | via WS /ws/fund/transfer; call EAI FT01 ~ A01 | 1 | low (single sample) |
| Enterprise FundTransfer | data.accountNo = FAKE-ACCT-0009 | via WS /ws/fund/transfer; call EAI FT01 ~ A01 \| FT01 ~ A02 | 1 | low (single sample) |
| Enterprise RewardsBalance | always (every observed call) | internal process | 1 | low (single sample) |

## 2. EAI and downstream mapping

| Enterprise endpoint | EAI SvcCode | Downstream system | Direction | Evidence | Flag |
|---|---|---|---|---|---|
| AccountInquiry | ACCT ~ INQ01 \| ACCT ~ BAL02 \| ACCT ~ LMT03 | not logged | request + response | 1 session(s) | ⚑ SvcCode with no downstream log (system behind EAI not logged or not mapped) |
| Customer360 | CIF1 ~ PRF01 | not logged | request + response | 1 session(s) | ⚑ SvcCode with no downstream log (system behind EAI not logged or not mapped) |
| Customer360 | — | OPI (/opi/v2/customer/profile) | request + response | 1 session(s) | ⚑ downstream log with no SvcCode (direct call, not via EAI) |
| Customer360 | — | WAM (/wam/v1/limits) | request + response | 1 session(s) | ⚑ downstream log with no SvcCode (direct call, not via EAI) |
| Customer360 | — | CUS (/cus/v1/customer/segment) | request + response | 1 session(s) | ⚑ downstream log with no SvcCode (direct call, not via EAI) |
| FundTransfer | FT01 ~ A01 | not logged | request only | 1 session(s) | ⚑ SvcCode with no downstream log (system behind EAI not logged or not mapped) |
| FundTransfer | FT01 ~ A01 \| FT01 ~ A02 | not logged | request + response | 1 session(s) | ⚑ SvcCode with no downstream log (system behind EAI not logged or not mapped) |

## 3. Sequence and dependency

A pair of calls is **sequential** when the next request is logged at or after the previous response, and **overlapping** only when it is logged before that response. Calls that merely sit close together in time are not counted as parallel. **Undetermined** means the previous call has no response to compare with. A child that appears in only some calls of the same caller is **conditional**.

| Caller | Calls | Verdict | Pairs seq / overlap / undetermined | Conditional children | Example (EventTime, ElapsedMs) |
|---|---|---|---|---|---|
| WS /ws/customer/360 | 1 | overlapping | 2 / 1 / 0 | — | WAM /wam/v1/limits: request 2026-10-27 09:15:10.640, response 2026-10-27 09:15:12.685 (ElapsedMs 45); next CUS /cus/v1/customer/segment request 2026-10-27 09:15:10.688 → gap -1997 ms |
| WS /ws/fund/transfer | 2 | one call each time | 0 / 0 / 0 | EAI FT01 ~ A01 in 1 of 2; EAI FT01 ~ A01 \| FT01 ~ A02 in 1 of 2 | — |
| eComm getDashboard | 1 | sequential | 1 / 0 / 0 | — | Enterprise AccountSummary: request 2026-10-27 09:15:53.457, response 2026-10-27 09:15:53.510 (ElapsedMs 53); next Enterprise RewardsBalance request 2026-10-27 09:15:53.514 → gap 4 ms |

## 4. Failure handling

Failure point = the earliest hop that failed or never got a response (a missing response is placed at its request time, so a timeout shows up at the hop that went silent).

| Session | Failure point | Error signal | Retry observed | Fallback observed | Final caller response |
|---|---|---|---|---|---|
| 000000000007 | EAI FT01 ~ A01 (step 4) | no response logged; caller reported "504 EAI timeout after 30000 ms" | no | no | 9001 FAILED "Service temporarily unavailable" |
| 000000000009 | WS /ws/fund/transfer (step 3) | no response logged | no | no | 1020 FAILED "Transfer could not be completed" |
| 000000000014 | Enterprise RewardsBalance (step 4) | ErrCode E3001, "Rewards service unavailable", HTTP 200 | no | no | 0000 SUCCESS |

## 5. Data propagation

**sessionId in the raw log, by layer:**

| Layer | Carries sessionId | Linked through LinkKey | Not linked |
|---|---|---|---|
| eComm | 10 | 0 | 0 |
| Enterprise | 12 | 0 | 0 |
| WS | 16 | 0 | 0 |
| Host | 0 | 7 | 0 |

**transactionRef from caller to callee:**

| Edge | Observed | Sessions |
|---|---|---|
| eComm → Enterprise | new value generated | 5 |
| Enterprise → WS | same value | 4 |
| WS → Host | same value, renamed to the Host link tag (<RqUID>…</RqUID>) | 4 |
| WS → OPI | same value | 1 |
| WS → WAM | same value | 1 |
| WS → CUS | same value | 1 |

**eComm request fields, followed down the call tree:**

| Field | Into layer | Observed | Sessions |
|---|---|---|---|
| data.customerId | Enterprise | not passed on | 5 |
| data.customerId | WS | not passed on | 4 |
| data.customerId | Host | not passed on | 4 |
| data.customerId | OPI | not passed on | 1 |
| data.customerId | WAM | not passed on | 1 |
| data.customerId | CUS | not passed on | 1 |

## 6. Latency baseline (ElapsedMs)

| Endpoint | n | Min | Median | Max | Outliers |
|---|---|---|---|---|---|
| CUS /cus/v1/customer/segment | 1 | 33 | 33 | 33 | n < 3: no outlier test |
| Enterprise AccountInquiry | 1 | 277 | 277 | 277 | n < 3: no outlier test |
| Enterprise AccountSummary | 1 | 53 | 53 | 53 | n < 3: no outlier test |
| Enterprise Customer360 | 1 | 345 | 345 | 345 | n < 3: no outlier test |
| Enterprise FundTransfer | 2 | 248 | 15134 | 30020 | n < 3: no outlier test |
| Enterprise RewardsBalance | 1 | 27 | 27 | 27 | n < 3: no outlier test |
| Host ACCT | 1 | 244 | 244 | 244 | n < 3: no outlier test |
| Host CIF1 | 1 | 159 | 159 | 159 | n < 3: no outlier test |
| Host FT01 | 1 | 213 | 213 | 213 | n < 3: no outlier test |
| OPI /opi/v2/customer/profile | 1 | 68 | 68 | 68 | n < 3: no outlier test |
| WAM /wam/v1/limits | 1 | 45 | 45 | 45 | n < 3: no outlier test |
| WS /ws/account/inquiry | 1 | 261 | 261 | 261 | n < 3: no outlier test |
| WS /ws/customer/360 | 1 | 328 | 328 | 328 | n < 3: no outlier test |
| WS /ws/fund/transfer | 1 | 30005 | 30005 | 30005 | n < 3: no outlier test |
| eComm fundTransfer | 2 | 262 | 15148 | 30033 | n < 3: no outlier test |
| eComm getAccountDetails | 1 | 292 | 292 | 292 | n < 3: no outlier test |
| eComm getCustomer360 | 1 | 360 | 360 | 360 | n < 3: no outlier test |
| eComm getDashboard | 1 | 100 | 100 | 100 | n < 3: no outlier test |

_No outliers (rule: more than 3 × the median and over 100 ms above it, with at least 3 samples)._

## 7. Success and failure patterns

**Failure rate** = FAILED responses ÷ all responses. Requests that never got a response are counted separately.

| Endpoint | Responses | FAILED | Failure rate | No response | UNKNOWN |
|---|---|---|---|---|---|
| CUS /cus/v1/customer/segment | 1 | 0 | 0% | 0 | 0 |
| Enterprise AccountInquiry | 1 | 0 | 0% | 0 | 0 |
| Enterprise AccountSummary | 1 | 0 | 0% | 0 | 0 |
| Enterprise Customer360 | 1 | 0 | 0% | 0 | 0 |
| Enterprise FundTransfer | 2 | 1 | 50% | 0 | 0 |
| Enterprise RewardsBalance | 1 | 1 | 100% | 0 | 0 |
| Host ACCT | 1 | 0 | 0% | 0 | 0 |
| Host CIF1 | 1 | 0 | 0% | 0 | 0 |
| Host FT01 | 1 | 1 | 100% | 1 | 0 |
| OPI /opi/v2/customer/profile | 1 | 0 | 0% | 0 | 0 |
| WAM /wam/v1/limits | 1 | 0 | 0% | 0 | 0 |
| WS /ws/account/inquiry | 1 | 0 | 0% | 0 | 0 |
| WS /ws/customer/360 | 1 | 0 | 0% | 0 | 0 |
| WS /ws/fund/transfer | 1 | 1 | 100% | 1 | 0 |
| eComm fundTransfer | 2 | 2 | 100% | 0 | 0 |
| eComm getAccountDetails | 1 | 0 | 0% | 0 | 0 |
| eComm getCustomer360 | 1 | 0 | 0% | 0 | 0 |
| eComm getDashboard | 1 | 0 | 0% | 0 | 0 |

**Error code taxonomy** (deepest layer first, which is usually where the code originates):

| Code | Field | Layers | Deepest layer | Count | Meaning |
|---|---|---|---|---|---|
| E102 | RespCode | Host | Host | 1 | not inferable: no description |
| 504 | RespCode | WS | WS | 1 | Gateway Timeout (standard HTTP meaning, if this is an HTTP status) |
| E1020 | ErrCode | Enterprise | Enterprise | 1 | "Debit leg failed at host" (from ErrDesc) |
| E3001 | ErrCode | Enterprise | Enterprise | 1 | "Rewards service unavailable" (from ErrDesc) |
| E9001 | ErrCode | Enterprise | Enterprise | 1 | "Downstream EAI timeout" (from ErrDesc) |
| 1020 | RespCode | eComm | eComm | 1 | "Transfer could not be completed" (from ErrDesc) |
| 9001 | RespCode | eComm | eComm | 1 | "Service temporarily unavailable" (from ErrDesc) |

**Failure propagation** (from the failure point up to the app):

- `000000000007`: EAI FT01 ~ A01: **no response** → WS /ws/fund/transfer: **504** _(timeout surfaced as 504)_ → Enterprise FundTransfer: **E9001** _(reported SUCCESS despite the failure below)_ → eComm fundTransfer: **9001** _(different code (504 → 9001))_
- `000000000009`: WS /ws/fund/transfer: **no response** → Enterprise FundTransfer: **E1020** _(timeout surfaced as E1020)_ → eComm fundTransfer: **1020** _(wrapped: same number, new prefix (E1020 → 1020))_
- `000000000014`: Enterprise RewardsBalance: **E3001** → eComm getDashboard: **SUCCESS** _(absorbed: the caller still succeeded)_

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
| E3001 | `Enterprise RewardsBalance\nE3001 Rewards service unavailable` |

## 8. Rule confidence and gaps

**Confirmed by several sessions:**

- eComm fundTransfer: call 1 Enterprise API: FundTransfer (2 sessions)
- transactionRef on eComm → Enterprise: new value generated (5 session(s))
- transactionRef on Enterprise → WS: same value (4 session(s))
- transactionRef on WS → Host: same value, renamed to the Host link tag (<RqUID>…</RqUID>) (4 session(s))

**Single-sample observations:**

- eComm getAccountDetails: call 1 Enterprise API: AccountInquiry (1 session)
- eComm getCustomer360: call 1 Enterprise API: Customer360 (1 session)
- eComm getDashboard: call 2 Enterprise APIs: AccountSummary → RewardsBalance (1 session)
- Enterprise AccountInquiry: via WS /ws/account/inquiry; call EAI ACCT ~ INQ01 | ACCT ~ BAL02 | ACCT ~ LMT03 (1 session)
- Enterprise AccountSummary: internal process (1 session)
- Enterprise Customer360: via WS /ws/customer/360; call EAI CIF1 ~ PRF01; call downstream OPI /opi/v2/customer/profile; call downstream WAM /wam/v1/limits; call downstream CUS /cus/v1/customer/segment (1 session)
- Enterprise FundTransfer: when data.accountNo = FAKE-ACCT-0007, via WS /ws/fund/transfer; call EAI FT01 ~ A01 (1 session)
- Enterprise FundTransfer: when data.accountNo = FAKE-ACCT-0009, via WS /ws/fund/transfer; call EAI FT01 ~ A01 | FT01 ~ A02 (1 session)
- Enterprise RewardsBalance: internal process (1 session)
- transactionRef on WS → OPI: same value (1 session(s))
- transactionRef on WS → WAM: same value (1 session(s))
- transactionRef on WS → CUS: same value (1 session(s))

**Inferred but unverified:**

- Enterprise AccountSummary: "internal process" means no downstream call was logged; the processing itself is not visible.
- Enterprise RewardsBalance: "internal process" means no downstream call was logged; the processing itself is not visible.
- WS is drawn as Enterprise calling its own web service (Phase 0 Q8 not yet confirmed).
- Systems behind EAI (BWC, ICH, …) are not visible in the logs; SvcCode → system mapping comes from config, if given.
- Downstream system names come from WS URL prefixes in the config.

**Contradicted or unexplained:**

_None._

**What would close the gaps:**

- Scenario A (eComm internal processing only) not observed: include at least two sessions showing it.
- Scenario B (eComm → one Enterprise API, Enterprise internal) not observed: include at least two sessions showing it.
- eComm getAccountDetails → call 1 Enterprise API: AccountInquiry: seen once; one more session would confirm it.
- eComm getCustomer360 → call 1 Enterprise API: Customer360: seen once; one more session would confirm it.
- eComm getDashboard → call 2 Enterprise APIs: AccountSummary → RewardsBalance: seen once; one more session would confirm it.
- Enterprise AccountInquiry → via WS /ws/account/inquiry; call EAI ACCT ~ INQ01 | ACCT ~ BAL02 | ACCT ~ LMT03: seen once; one more session would confirm it.
- Enterprise AccountSummary → internal process: seen once; one more session would confirm it.
- Enterprise Customer360 → via WS /ws/customer/360; call EAI CIF1 ~ PRF01; call downstream OPI /opi/v2/customer/profile; call downstream WAM /wam/v1/limits; call downstream CUS /cus/v1/customer/segment: seen once; one more session would confirm it.
- Enterprise FundTransfer → via WS /ws/fund/transfer; call EAI FT01 ~ A01: seen once; one more session would confirm it.
- Enterprise FundTransfer → via WS /ws/fund/transfer; call EAI FT01 ~ A01 | FT01 ~ A02: seen once; one more session would confirm it.
- Enterprise RewardsBalance → internal process: seen once; one more session would confirm it.
- SvcCode → backend system (BWC, ICH, …): give the mapping in the config (`svcSystems`), or include the backend logs.
- Latency baselines with fewer than 3 samples (18 endpoint(s)): more sessions per endpoint are needed before calling anything an outlier.
