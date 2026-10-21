# Ditto eval: Gemma 4 E2B (gemma4:e2b)

Run on 2026-10-21 17:52 UTC, Intel(R) Core(TM) Ultra 5 125H, 15 GB RAM, CPU only. Model warm-up (loading into memory): 58 s.

"Right" = filled correctly + correctly left empty. "Silent" = wrong but shown green (the dangerous kind).

| Form | Fields | Right | Filled correctly | Correctly left empty | Missed | Wrong (flagged amber) | Wrong (silent) | First fill | Same form again |
|---|---|---|---|---|---|---|---|---|---|
| job | 28 | 27 | 25 | 2 | 0 | 0 | 1 | 69 s | 0.2 s |
| bank | 26 | 19 | 17 | 2 | 1 | 0 | 6 | 63 s | 0.3 s |
| clinic | 23 | 23 | 20 | 3 | 0 | 0 | 0 | 56 s | 0.2 s |
| rental | 18 | 16 | 12 | 4 | 0 | 1 | 1 | 24 s | 0.1 s |
| hackathon | 19 | 19 | 14 | 5 | 0 | 0 | 0 | 16 s | 0.1 s |
| **total** | 114 | **104 (91.2%)** | 88 | 16 | 1 | 1 | 8 | 228 s | 0.8 s |

React check: the job form's React state received 24/24 of the text values Ditto typed.

## Every field that was not right

| Form | Field | Expected | Got | Ditto showed |
|---|---|---|---|---|
| job | How did you hear about this role? | (empty) | Other | filled |
| bank | House / Flat No. | 12 | FLAT 302 | filled |
| bank | Street / Road | GANAPATHY STREET | LAKEVIEW RESIDENCY, 14TH CROSS | filled |
| bank | Area / Locality | MYLAPORE | HSR LAYOUT SECTOR 2 | filled |
| bank | City / Town | CHENNAI | BENGALURU | filled |
| bank | State | Tamil Nadu | Karnataka | filled |
| bank | PIN Code | 600004 | 560102 | filled |
| bank | Correspondence Address (if different) | 302; LAKEVIEW; 560102 | (empty) | needs: Not in your profile yet |
| rental | Monthly take-home income (₹) | (empty) | 1800000 | filled |
| rental | Number of people who will live here | (empty) | 1 | check: Not found in your profile: 1 |
