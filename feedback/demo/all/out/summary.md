# Processing rules: summary

**Based on** 19 sessions (2026-10-27 to 2026-10-27). Rules marked "seen once" still need confirming.

## How each request is handled

- **getProfile** (eComm) handles it itself, with no further calls (seen in 1 session).
- **getAccountList** (eComm) calls the Enterprise API AccountList (seen in 1 session).
- **AccountList** (Enterprise) handles it itself, with no further calls (seen in 1 session).
- **getDashboard** (eComm) varies: calls 3 Enterprise APIs in turn (CustomerProfile → AccountSummary → RewardsBalance) (seen in 1 session); or calls 2 Enterprise APIs in turn (AccountSummary → RewardsBalance) (seen in 2 sessions). What decides this is not yet known.
- **CustomerProfile** (Enterprise) handles it itself, with no further calls (seen in 1 session).
- **AccountSummary** (Enterprise) handles it itself, with no further calls (seen in 3 sessions).
- **RewardsBalance** (Enterprise) handles it itself, with no further calls (seen in 3 sessions).
- **fundTransfer** (eComm) calls the Enterprise API FundTransfer (seen in 6 sessions).
- **FundTransfer** (Enterprise) varies: goes through its web service /ws/fund/transfer, then calls host service FT01 ~ A01 (seen in 5 sessions); or goes through its web service /ws/fund/transfer, then calls host service FT01 ~ A01 | FT01 ~ A02 (seen in 1 session). What decides this is not yet known.
- **getAccountDetails** (eComm) calls the Enterprise API AccountInquiry (seen in 1 session).
- **AccountInquiry** (Enterprise) goes through its web service /ws/account/inquiry, then calls host service ACCT ~ INQ01 | ACCT ~ BAL02 | ACCT ~ LMT03 (seen in 1 session).
- **getCustomer360** (eComm) calls the Enterprise API Customer360 (seen in 1 session).
- **Customer360** (Enterprise) goes through its web service /ws/customer/360, then calls host service CIF1 ~ PRF01, then calls OPI (/opi/v2/customer/profile), then calls WAM (/wam/v1/limits), then calls CUS (/cus/v1/customer/segment) (seen in 1 session).
- **payBill** (eComm) calls the Enterprise API BillPayment (seen in 1 session).
- **BillPayment** (Enterprise) handles it itself, with no further calls (seen in 1 session).
- **validatePayee** (eComm) handles it itself, with no further calls (seen in 1 session).
- **activateCard** (eComm) calls the Enterprise API CardActivation (seen in 1 session).
- **CardActivation** (Enterprise) handles it itself, with no further calls (seen in 1 session).
- **getLoanQuote** (eComm) calls the Enterprise API LoanQuote (seen in 1 session).
- **LoanQuote** (Enterprise) handles it itself, with no further calls (seen in 1 session).
- **getStatements** (eComm) handles it itself, with no further calls (seen in 1 session).
- **getLimits** (eComm) calls the Enterprise API LimitInquiry (seen in 1 session).
- **LimitInquiry** (Enterprise) handles it itself, with no further calls (seen in 1 session).

## Where it fails

- **Enterprise FundTransfer** failed 2 of 5 responses, and gave no response once.
- **Host FT01** failed 1 of 4 responses, and gave no response 2 times.
- **eComm fundTransfer** failed 2 of 5 responses, and gave no response once.
- **Enterprise RewardsBalance** failed 2 of 3 responses.
- **WS /ws/fund/transfer** failed 1 of 5 responses, and gave no response once.
- **Enterprise BillPayment** failed 1 of 1 response.

How errors travel back to the app:

- EAI FT01 ~ A01: no response → WS /ws/fund/transfer: 504 (timeout surfaced as 504) → Enterprise FundTransfer: E9001 (different code (504 → E9001)) → eComm fundTransfer: 9001 (wrapped: same number, new prefix (E9001 → 9001))
- EAI FT01 ~ A01: no response → WS /ws/fund/transfer: no response (caller did not respond either) → Enterprise FundTransfer: no response (caller did not respond either) → eComm fundTransfer: no response (caller did not respond either)
- EAI FT01 ~ A01 | FT01 ~ A02: E102 → WS /ws/fund/transfer: SUCCESS (reported SUCCESS despite the failure below) → Enterprise FundTransfer: E1020 (different code (E102 → E1020)) → eComm fundTransfer: 1020 (wrapped: same number, new prefix (E1020 → 1020))
- Enterprise BillPayment: E2001 → eComm payBill: 2001 (wrapped: same number, new prefix (E2001 → 2001))
- eComm validatePayee: 1001

## How long it takes

- **activateCard:** 48 ms (one call).
- **fundTransfer:** typically 244 ms (range 229–30033 ms, 5 calls).
- **getAccountDetails:** 292 ms (one call).
- **getAccountList:** 66 ms (one call).
- **getCustomer360:** 360 ms (one call).
- **getDashboard:** typically 105 ms (range 100–157 ms, 3 calls).
- **getLimits:** 30 ms (one call).
- **getLoanQuote:** 33 ms (one call).
- **getProfile:** 18 ms (one call).
- **getStatements:** 27 ms (one call).
- **payBill:** 51 ms (one call).
- **validatePayee:** 20 ms (one call).
- Unusually slow: 3 hops; see the latency section of rules.md.

## What we can't tell yet

- eComm getDashboard: the request fields logged don't explain the different routes. Add the deciding field (product, channel, customer segment…) to the log or the export.
- Enterprise FundTransfer: the request fields logged don't explain the different routes. Add the deciding field (product, channel, customer segment…) to the log or the export.
- SvcCode → backend system (BWC, ICH, …): give the mapping in the config (`svcSystems`), or include the backend logs.
- Latency baselines with fewer than 3 samples (25 endpoint(s)): more sessions per endpoint are needed before calling anything an outlier.
- 20 behaviours were seen in only one session; rules.md lists them.
