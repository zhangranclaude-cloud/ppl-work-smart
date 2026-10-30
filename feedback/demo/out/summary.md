# Processing rules: summary

**Based on** 5 sessions (2026-10-27 to 2026-10-27). Rules marked "seen once" still need confirming.

## How each request is handled

- **getAccountDetails** (eComm) calls the Enterprise API AccountInquiry (seen in 1 session).
- **AccountInquiry** (Enterprise) goes through its web service /ws/account/inquiry, then calls host service ACCT ~ INQ01 | ACCT ~ BAL02 | ACCT ~ LMT03 (seen in 1 session).
- **getCustomer360** (eComm) calls the Enterprise API Customer360 (seen in 1 session).
- **Customer360** (Enterprise) goes through its web service /ws/customer/360, then calls host service CIF1 ~ PRF01, then calls OPI (/opi/v2/customer/profile), then calls WAM (/wam/v1/limits), then calls CUS (/cus/v1/customer/segment) (seen in 1 session).
- **fundTransfer** (eComm) calls the Enterprise API FundTransfer (seen in 2 sessions).
- **FundTransfer** (Enterprise) varies: goes through its web service /ws/fund/transfer, then calls host service FT01 ~ A01 (seen in 1 session); or goes through its web service /ws/fund/transfer, then calls host service FT01 ~ A01 | FT01 ~ A02 (seen in 1 session). What decides this is shown in the routing table.
- **getDashboard** (eComm) calls 2 Enterprise APIs in turn (AccountSummary → RewardsBalance) (seen in 1 session).
- **AccountSummary** (Enterprise) handles it itself, with no further calls (seen in 1 session).
- **RewardsBalance** (Enterprise) handles it itself, with no further calls (seen in 1 session).

## Where it fails

- **Host FT01** failed 1 of 1 response, and gave no response once.
- **WS /ws/fund/transfer** failed 1 of 1 response, and gave no response once.
- **eComm fundTransfer** failed 2 of 2 responses.
- **Enterprise FundTransfer** failed 1 of 2 responses.
- **Enterprise RewardsBalance** failed 1 of 1 response.

How errors travel back to the app:

- EAI FT01 ~ A01: no response → WS /ws/fund/transfer: 504 (timeout surfaced as 504) → Enterprise FundTransfer: E9001 (reported SUCCESS despite the failure below) → eComm fundTransfer: 9001 (different code (504 → 9001))
- WS /ws/fund/transfer: no response → Enterprise FundTransfer: E1020 (timeout surfaced as E1020) → eComm fundTransfer: 1020 (wrapped: same number, new prefix (E1020 → 1020))
- Enterprise RewardsBalance: E3001 → eComm getDashboard: SUCCESS (absorbed: the caller still succeeded)

## How long it takes

- **fundTransfer:** typically 15148 ms (range 262–30033 ms, 2 calls).
- **getAccountDetails:** 292 ms (one call).
- **getCustomer360:** 360 ms (one call).
- **getDashboard:** 100 ms (one call).

## What we can't tell yet

- Scenario A (eComm internal processing only) not observed: include at least two sessions showing it.
- Scenario B (eComm → one Enterprise API, Enterprise internal) not observed: include at least two sessions showing it.
- SvcCode → backend system (BWC, ICH, …): give the mapping in the config (`svcSystems`), or include the backend logs.
- Latency baselines with fewer than 3 samples (18 endpoint(s)): more sessions per endpoint are needed before calling anything an outlier.
- 9 behaviours were seen in only one session; rules.md lists them.
