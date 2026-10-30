# Traceline feedback report

## 1. Inputs

- **Export:** `export.csv`: 111 rows, 19 session(s).
- **Columns:** all 13 expected columns present.
- **EventTime format:** ms precision.
- **Raw log:** `raw.log`: 111 events (0 multi-line), 111 recognised as a layer request or response.
- **Clock offset:** none detected.
- **Tolerance:** ±500 ms after the offset (widened to the export's time precision when it has no milliseconds).

## 2. Alignment

Keys: sessionId, layer, direction and API (with any `Request`/`Response` suffix ignored), then the nearest timestamp. Full table: `alignment.csv`.

| Match | Meaning | Rows |
|---|---|---|
| EXACT | All keys match; same timestamp | 111 |
| NEAR | All keys match; timestamp within ±500 ms | 0 |
| TIME-MISMATCH | All keys match, but the timestamp is beyond tolerance | 0 |
| WEAK-API | Same session, layer and direction within tolerance; the API differs | 0 |
| NO-SID | Export row has no session; matched on layer, direction, API and time | 0 |
| NONE | No raw log line found | 0 |

## 3. Data quality checks

### 3.1 Rows with no sessionId

None.

### 3.2 Missing request or response (in the export)

- Session `000000000007` row 49 (step 4, Host Request FT01): request with no response. The raw log has no response either: a genuine missing response, such as a timeout or a request still in flight.
- Session `000000000008` row 53 (step 1, eComm Request fundTransfer): request with no response. The raw log has no response either: a genuine missing response, such as a timeout or a request still in flight.
- Session `000000000008` row 54 (step 2, Enterprise Request FundTransfer): request with no response. The raw log has no response either: a genuine missing response, such as a timeout or a request still in flight.
- Session `000000000008` row 55 (step 3, WS Request /ws/fund/transfer): request with no response. The raw log has no response either: a genuine missing response, such as a timeout or a request still in flight.
- Session `000000000008` row 56 (step 4, Host Request FT01): request with no response. The raw log has no response either: a genuine missing response, such as a timeout or a request still in flight.

### 3.3 Timestamps beyond tolerance (±500 ms)

None.

### 3.4 Export rows with no raw log line

None.

### 3.5 Raw log lines not mapped to any export row

None.

### 3.6 Layers or hops in the log but not in the export

None.

### 3.7 HopStatus that contradicts the raw response

None.

### 3.8 SessionStatus consistency

None.

## 4. Sequence diagrams

- `session-000000000001.puml`: session `fa4e0000-0000-4000-8000-000000000001`, SUCCESS
- `session-000000000002.puml`: session `fa4e0000-0000-4000-8000-000000000002`, SUCCESS
- `session-000000000003.puml`: session `fa4e0000-0000-4000-8000-000000000003`, SUCCESS
- `session-000000000004.puml`: session `fa4e0000-0000-4000-8000-000000000004`, SUCCESS
- `session-000000000005.puml`: session `fa4e0000-0000-4000-8000-000000000005`, SUCCESS
- `session-000000000006.puml`: session `fa4e0000-0000-4000-8000-000000000006`, SUCCESS
- `session-000000000007.puml`: session `fa4e0000-0000-4000-8000-000000000007`, FAILED, first failed: WS: /ws/fund/transfer
- `session-000000000008.puml`: session `fa4e0000-0000-4000-8000-000000000008`, UNKNOWN
- `session-000000000009.puml`: session `fa4e0000-0000-4000-8000-000000000009`, FAILED, first failed: Host: FT01
- `session-000000000010.puml`: session `fa4e0000-0000-4000-8000-000000000010`, FAILED, first failed: Enterprise: BillPayment
- `session-000000000011.puml`: session `fa4e0000-0000-4000-8000-000000000011`, FAILED, first failed: eComm: validatePayee
- `session-000000000012.puml`: session `fa4e0000-0000-4000-8000-000000000012`, SUCCESS
- `session-000000000013.puml`: session `fa4e0000-0000-4000-8000-000000000013`, SUCCESS
- `session-000000000014.puml`: session `fa4e0000-0000-4000-8000-000000000014`, PARTIAL, first failed: Enterprise: RewardsBalance
- `session-000000000015.puml`: session `fa4e0000-0000-4000-8000-000000000015`, FAILED, first failed: Enterprise: RewardsBalance
- `session-000000000016.puml`: session `fa4e0000-0000-4000-8000-000000000016`, FAILED, first failed: Enterprise: CardActivation
- `session-000000000017.puml`: session `fa4e0000-0000-4000-8000-000000000017`, FAILED, first failed: Enterprise: LoanQuote
- `session-000000000018.puml`: session `fa4e0000-0000-4000-8000-000000000018`, FAILED, first failed: eComm: getStatements
- `session-000000000019.puml`: session `fa4e0000-0000-4000-8000-000000000019`, SUCCESS

## 5. Diagram vs evidence

**Session `000000000001`**

- **Directly supported:** 2 of 2 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for eComm getProfile, because no downstream call was logged between its request and response.

**Session `000000000002`**

- **Directly supported:** 4 of 4 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for Enterprise AccountList, because no downstream call was logged between its request and response.

**Session `000000000003`**

- **Directly supported:** 8 of 8 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for Enterprise CustomerProfile, Enterprise AccountSummary, Enterprise RewardsBalance, because no downstream call was logged between its request and response.

**Session `000000000004`**

- **Directly supported:** 8 of 8 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.

**Session `000000000005`**

- **Directly supported:** 8 of 8 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.

**Session `000000000006`**

- **Directly supported:** 14 of 14 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); downstream participants named from the URL prefix (`downstream` in the config); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.

**Session `000000000007`**

- **Directly supported:** 7 of 7 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.
- **No response logged:** step 4 Host FT01. The orange arrow shows that nothing came back, not why.

**Session `000000000008`**

- **Directly supported:** 4 of 4 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.
- **No response logged:** step 1 eComm fundTransfer, step 2 Enterprise FundTransfer, step 3 WS /ws/fund/transfer, step 4 Host FT01. The orange arrow shows that nothing came back, not why.

**Session `000000000009`**

- **Directly supported:** 8 of 8 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.

**Session `000000000010`**

- **Directly supported:** 4 of 4 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for Enterprise BillPayment, because no downstream call was logged between its request and response.

**Session `000000000011`**

- **Directly supported:** 2 of 2 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for eComm validatePayee, because no downstream call was logged between its request and response.

**Session `000000000012`**

- **Directly supported:** 8 of 8 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.

**Session `000000000013`**

- **Directly supported:** 8 of 8 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.

**Session `000000000014`**

- **Directly supported:** 6 of 6 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for Enterprise AccountSummary, Enterprise RewardsBalance, because no downstream call was logged between its request and response.

**Session `000000000015`**

- **Directly supported:** 6 of 6 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for Enterprise AccountSummary, Enterprise RewardsBalance, because no downstream call was logged between its request and response.

**Session `000000000016`**

- **Directly supported:** 4 of 4 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for Enterprise CardActivation, because no downstream call was logged between its request and response.

**Session `000000000017`**

- **Directly supported:** 4 of 4 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for Enterprise LoanQuote, because no downstream call was logged between its request and response.

**Session `000000000018`**

- **Directly supported:** 2 of 2 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for eComm getStatements, because no downstream call was logged between its request and response.

**Session `000000000019`**

- **Directly supported:** 4 of 4 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for Enterprise LimitInquiry, because no downstream call was logged between its request and response.

## 6. Host SvcCode pairing checks

- No problems found in the logged Host messages: every message has main/sub pairs with one status per pair.

Always true of this diagram: the Host arrow is labelled with the **first** main code, and its colour reflects the **whole** message. A failed sub-service turns the hop red; the note lists each pair's status from the raw log so you can see which one.
