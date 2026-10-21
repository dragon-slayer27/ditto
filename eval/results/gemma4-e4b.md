# Ditto eval: Gemma 4 E4B (gemma4:e4b-it-qat)

Run on 2026-10-21 17:22 UTC, Intel(R) Core(TM) Ultra 5 125H, 15 GB RAM, CPU only. Model warm-up (loading into memory): 0.0 s.

"Right" = filled correctly + correctly left empty. "Silent" = wrong but shown green (the dangerous kind).

| Form | Fields | Right | Filled correctly | Correctly left empty | Missed | Wrong (flagged amber) | Wrong (silent) | First fill | Same form again |
|---|---|---|---|---|---|---|---|---|---|
| job | 28 | 28 | 25 | 3 | 0 | 0 | 0 | 50 s | 0.1 s |
| bank | 26 | 26 | 24 | 2 | 0 | 0 | 0 | 54 s | 0.1 s |
| clinic | 23 | 23 | 20 | 3 | 0 | 0 | 0 | 45 s | 0.1 s |
| rental | 18 | 16 | 12 | 4 | 0 | 2 | 0 | 27 s | 0.1 s |
| hackathon | 19 | 19 | 14 | 5 | 0 | 0 | 0 | 26 s | 0.1 s |
| **total** | 114 | **112 (98.2%)** | 95 | 17 | 0 | 2 | 0 | 202 s | 0.4 s |

React check: the job form's React state received 23/23 of the text values Ditto typed.

## Every field that was not right

| Form | Field | Expected | Got | Ditto showed |
|---|---|---|---|---|
| rental | Monthly take-home income (₹) | (empty) | 150000 | check: Not found in your profile: 150000 |
| rental | Number of people who will live here | (empty) | 1 | check: Not found in your profile: 1 |
