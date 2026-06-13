// ============ AI PROMPTS ============
//
// SCH3_PROMPT  — substantive Schedule III (Division I) review covering the
//                24-Mar-2021 MCA amendment + AS compliance + Companies Act
//                disclosures + presentation/rounding tests.
// CARO_PROMPT  — lightweight CARO 2020 applicability + clause-flagging.
//
// DO NOT EDIT casually. These prompts are the canonical business logic of
// this tool. Any change here MUST be tested against at least one real
// engagement before shipping.
//
// Usage:
//   Schedule III: send as `userPrompt` after prepending the extracted markdown.
//   CARO:         call CARO_PROMPT(keyMetrics, companyName, isFirstYear, natureOfBusiness)
//                 and send the returned string as `userPrompt`.

export const SCH3_PROMPT = `Reviewer: senior Indian Chartered Accountant. Standards in scope:
- Schedule III to the Companies Act 2013, Division I (AS basis), as amended by MCA Notification G.S.R. 207(E) dated 24-Mar-2021.
- Accounting Standards (AS) notified under Section 133 read with the Companies (Accounting Standards) Rules, 2021.
- Companies Act 2013 disclosures (Sec 134(3)(m), Sec 22 of MSMED Act 2006, Sec 135 CSR, Sec 197 Auditor's remuneration).
- Rule 6 of Companies (Accounts) Rules 2014 — rounding off.

Analyse the attached PDF (extracted markdown) of the standalone financial statements.

────────────────────────────────────────────
SEVERITY RUBRIC — apply strictly:
- CRITICAL : Material misstatement, arithmetic break, or item that would warrant a qualification / adverse opinion.
- HIGH     : Mandatory disclosure under amended Schedule III or AS is fully MISSING.
- MEDIUM   : Disclosure present but incomplete, ambiguous, or wrongly classified.
- LOW      : Presentation, rounding, comparatives, or cosmetic note structure only.

EVIDENCE CONTRACT — every issue MUST cite either:
(a) An actual rupee figure (in lakhs or as printed in the PDF), OR
(b) A short verbatim quote (≤30 words) from the disclosure being flagged, OR
(c) "Disclosure not located in the document" — only if you have read the entire markdown and the disclosure is genuinely absent.

DO-NOT-FLAG list (common false positives):
- Absence of the Director's Report or Board's Report (separate document, not in scope).
- Absence of the Independent Auditor's Report (separate document, not in scope).
- Absence of items relevant only to Ind AS Division II (Indian Accounting Standards) — this engagement is Division I.
- "Specified Bank Notes" disclosure (defunct after FY 2016-17).
- Absence of Cash Flow Statement for an OPC, Small Company or Dormant Company that qualifies for the AS-3 carve-out — verify against the company's classification before flagging.
- Absence of Section 197 disclosure for a private limited company (Sec 197 only applies to public/listed companies).
- Signing-block / DIN / place-and-date defects — flagged elsewhere in the engagement, not in this review.
- CIF imports / detailed forex expenditure breakdown — out of scope for this engagement.

TEST EXECUTION RULE for each test:
1. Read the TRIGGER — if not satisfied, SKIP this test silently (no output).
2. If TRIGGER is satisfied, evaluate the FAIL-IF condition.
3. If the test PASSES (no fail-if), SKIP silently.
4. If the test FAILS, emit ONE issue with the test ID and complete fields.

OUTPUT BUDGET (HARD CAP):
- Return at most 60 issues. If more than 60 distinct test failures exist, return the 60 highest-severity findings (CRITICAL first, then HIGH, then MEDIUM, then LOW), breaking ties by section order (A → B → C → D → E → F).
- Strict word budgets on each issue: title ≤ 12 words, observation ≤ 50 words, evidenceQuote ≤ 30 words, implication ≤ 25 words, recommendation ≤ 25 words.

────────────────────────────────────────────
RETURN ONLY VALID JSON (no markdown, no commentary):

{
  "company": {
    "name", "cin", "yearEnd", "incorporationDate", "registeredAddress",
    "natureOfBusiness", "isFirstYear", "auditFirm", "auditFirmFRN"
  },
  "keyMetrics": {
    "revenueLakhs", "profitBeforeTaxLakhs", "profitAfterTaxLakhs",
    "currentTaxLakhs", "paidUpCapitalLakhs", "reservesLakhs",
    "totalBorrowingsLakhs", "totalAssetsLakhs", "tradeReceivablesLakhs",
    "fixedAssetsLakhs", "advanceTaxLakhs", "isHoldingOrSubOfPublicCo",
    "averageNetProfit3YearsLakhs", "netWorthLakhs",
    "isHoldingCompany", "isSubsidiaryCompany"
  },
  "scheduleIIIIssues": [
    {
      "id":             "T01",
      "section":        "A",
      "severity":       "CRITICAL|HIGH|MEDIUM|LOW",
      "category":       "Disclosure|Classification|Computation|Policy|Presentation",
      "title":          "≤ 12 words",
      "observation":    "≤ 50 words. MUST cite a rupee figure or a verbatim phrase from the PDF where applicable.",
      "evidenceQuote":  "≤ 30 words verbatim from the PDF, or 'Disclosure not located in the document' if missing.",
      "noteRef":        "e.g. 'Note 12', 'Sch III Div I Gen Instr Para 6(L)(xi)', or 'Not provided'.",
      "implication":    "≤ 25 words on the audit / compliance consequence.",
      "recommendation": "≤ 25 words; concrete next step for the preparer."
    }
  ]
}

Order issues by severity: CRITICAL → HIGH → MEDIUM → LOW. Use the test ID as 'id'. Do not invent issues outside this test list.

════════════════════════════════════════════
SECTION A — INTERNAL CONSISTENCY [all CRITICAL]
════════════════════════════════════════════

T01  Tax–PBT alignment.
     TRIGGER  : Profit Before Tax > 0.
     FAIL IF  : Current tax expense = 0 AND no MAT computation, Sec 80-IAC / 115BAA / 115BAB / 115BAC election, brought-forward loss, or other exemption is disclosed in the notes.

T02  PPE absent despite operations.
     TRIGGER  : Revenue from operations > 0 OR Employee benefits expense > 0.
     FAIL IF  : Property, Plant & Equipment = 0 AND no Right-of-Use asset / Leasehold improvement / capital-light rationale (e.g., pure trading on commission, services from leased premises) is disclosed.

T03  Cash flow tie-back.
     TRIGGER  : Cash Flow Statement is presented.
     FAIL IF  : (Opening cash & cash equivalents − Closing cash & cash equivalents) does NOT equal the Net Increase/Decrease line in the CFS, OR the closing balance in the CFS does not tie to the Balance Sheet "Cash and cash equivalents" line.

T04  Advance tax / Provision for tax presentation.
     TRIGGER  : Both "Advance income tax (net of provision)" and "Provision for tax (net of advance)" appear, OR Advance tax > 0 with no Current tax in P&L.
     FAIL IF  : The two are not netted off where the same governing tax law applies, OR no reconciliation note is given.

T05  Share-issue / IPO / preliminary expenses charged to P&L.
     TRIGGER  : The P&L or notes disclose share issue expenses, IPO expenses, or preliminary expenses.
     FAIL IF  : The amount is expensed directly to P&L without amortisation under Sec 35D OR being written off against securities premium under Sec 52(2)(c).

T06  Reserves & Surplus arithmetic.
     TRIGGER  : Reserves & Surplus note is presented with opening, additions and deductions.
     FAIL IF  : Opening balance + Profit for the year ± transfers − dividend − tax on dividend − other appropriations does NOT equal the Closing balance for any individual reserve line.

T70  Balance Sheet balancing — Total Assets = Total Equity & Liabilities.
     TRIGGER  : A Balance Sheet is presented.
     FAIL IF  : Total Assets does NOT equal Total Equity & Liabilities (or Total Liabilities + Equity). Flag any variance exceeding Rs 1 lakh OR 0.5% of total assets, whichever is lower. Cite both figures and the absolute and percentage variance. This is a fundamental FS-integrity break — usually a sub-total typo or a misclassified line, NOT a rounding artefact.

T71  Notes-to-face tie-out — each significant BS line ties to its note total.
     TRIGGER  : Balance Sheet line items cross-reference notes (typical pattern: "Note 5", "Note 12", etc., next to the line).
     FAIL IF  : For any of the following significant Balance Sheet lines, the face value does NOT equal the total disclosed in the corresponding note (with comparatives tested for both years where presented). Test each that is non-zero:
       — Property, Plant & Equipment (face vs. PPE schedule "Total" / "Net block");
       — Capital Work-in-Progress (face vs. CWIP schedule total);
       — Intangible Assets (face vs. intangibles schedule total);
       — Non-current Investments (face vs. investments note total);
       — Current Investments (face vs. investments note total);
       — Long-term Loans & Advances (face vs. note total);
       — Other Non-current Assets (face vs. note total);
       — Inventories (face vs. inventories note total — by category);
       — Trade Receivables (face vs. ageing schedule + bifurcation total);
       — Cash & cash equivalents (face vs. note total);
       — Other Bank Balances (face vs. note total);
       — Short-term Loans & Advances (face vs. note total);
       — Other Current Assets (face vs. note total);
       — Share Capital (face vs. share capital note total);
       — Reserves & Surplus (face vs. R&S note total);
       — Long-term Borrowings (face vs. note total);
       — Short-term Borrowings (face vs. note total);
       — Long-term Provisions (face vs. note total);
       — Short-term Provisions (face vs. note total);
       — Trade Payables (face vs. payables ageing schedule total);
       — Other Current Liabilities (face vs. note total).
     Permit Rs 1 thousand absolute slack for rounding artefacts. Flag with the line item name, face value, note total, and variance.

T72  Within-note arithmetic — note components sum to the stated total.
     TRIGGER  : A note discloses a sub-total or "Total" line preceded by component line items.
     FAIL IF  : The sum of the component line items does NOT equal the stated Total within that note. Test ALL notes that have a Total line — Property Plant & Equipment schedule, Trade Receivables ageing, Trade Payables ageing, CWIP ageing, Investments note, Inventories note, Reserves & Surplus note, Share Capital note, Borrowings note, Loans & Advances note, Provisions note, Other Income, Employee Benefits Expense, Finance Costs, Other Expenses, etc. Flag the note title, the components, the computed sum, the disclosed Total, and the variance. Permit Rs 1 thousand slack.

T73  Opening = prior-year closing on every movement schedule.
     TRIGGER  : A movement schedule is presented for any line — Property Plant & Equipment, Reserves & Surplus, CWIP, Intangible Assets under Development, Investments, Provisions, etc. — showing both opening AND closing balances with comparatives.
     FAIL IF  : The current-year opening balance does NOT equal the prior-year closing balance for any line (gross block, accumulated depreciation, net block, each reserve type, etc.). Where a restatement occurred and is disclosed in a "reclassification" or "restatement" footnote, that explains the variance — do NOT flag in that case. Otherwise flag with the line item, the current opening, the prior closing, and the unexplained variance.

════════════════════════════════════════════
SECTION B — 2021 MCA AMENDMENT MANDATORY DISCLOSURES [all HIGH unless noted]
════════════════════════════════════════════

T07  Title deeds of immovable property.
     TRIGGER  : Land or buildings appear under PPE / Investment Property.
     FAIL IF  : The "Title deeds of immovable property NOT held in the name of the Company" tabular disclosure (gross block, held in name of, whether promoter/director/relative/employee, period, reason) is absent. If all title deeds ARE in the company's name, an explicit affirmative statement to that effect is required.

T08  Revaluation of PPE / Intangible assets.
     TRIGGER  : The accounting policy mentions revaluation OR a revaluation reserve appears under Reserves & Surplus.
     FAIL IF  : Disclosure does not specify that revaluation was based on the valuation by a registered valuer as defined under Rule 2 of the Companies (Registered Valuers and Valuation) Rules 2017.

T09  Loans/advances to promoters, directors, KMP, related parties.
     TRIGGER  : Loans & advances or other receivables are disclosed.
     FAIL IF  : Separate tabular disclosure is missing — "Type of borrower" (Promoter / Director / KMP / Related Party), "Amount of loan or advance in nature of loan outstanding", "Percentage to total Loans and Advances in nature of loans", with comparatives.

T10  CWIP ageing schedule.
     TRIGGER  : Capital Work-in-Progress > 0.
     FAIL IF  : Ageing schedule with buckets <1 year / 1-2 / 2-3 / >3 years is missing, OR projects-in-progress vs temporarily-suspended split is missing, OR for projects whose completion is overdue or has exceeded its original cost, the to-be-completed-in (<1y/1-2y/2-3y/>3y) schedule is missing.

T11  Intangible assets under development — ageing.
     TRIGGER  : Intangible assets under development > 0.
     FAIL IF  : Ageing schedule with buckets <1 year / 1-2 / 2-3 / >3 years is missing, OR overdue/cost-overrun schedule is missing.

T12  Benami property proceedings.
     FAIL IF  : The amended Schedule III declaration on whether any proceedings have been initiated or are pending against the Company under the Benami Transactions (Prohibition) Act, 1988 and Rules thereunder is missing. (Affirmative "No proceedings" statement is acceptable.)

T13  Quarterly returns / statements with banks or FIs (current-asset security).
     TRIGGER  : Borrowings from banks or financial institutions on the security of current assets (cash credit, working-capital limit, drawee bills) appear.
     FAIL IF  : Reconciliation of the quarterly returns / statements of current assets filed by the Company with the books of account is missing, OR material differences (with reasons) are not disclosed.

T14  Wilful defaulter declaration.
     FAIL IF  : Declaration that the Company has not been declared a wilful defaulter by any bank or FI or other lender (per RBI Master Direction) is missing — date of declaration and details required if declared. Affirmative "No" statement is acceptable.

T15  Relationship with struck-off companies.
     FAIL IF  : Disclosure of investments, balances receivable/payable, shares held with companies struck off under Sec 248 of the Companies Act 2013 / Sec 560 of the Companies Act 1956 is missing. Affirmative "No transactions" statement is acceptable.

T16  Registration / satisfaction of charges with ROC.
     TRIGGER  : The Company has any borrowings or debentures.
     FAIL IF  : Disclosure of registration of charges or satisfaction with the Registrar of Companies, including any pendency beyond the statutory period (within 30 days of creation), is missing.

T17  Compliance with Number of Layers — Sec 2(87)(b).
     TRIGGER  : The Company has subsidiaries.
     FAIL IF  : Disclosure of compliance with the Companies (Restriction on number of Layers) Rules 2017 is missing. CIN of each layer (where in compliance with the cap of 2 layers) should be provided.

T18  Approved Scheme of Arrangement.
     TRIGGER  : The notes refer to a Scheme of Arrangement under Sec 230-237.
     FAIL IF  : Disclosure that the accounting treatment is in accordance with the approved Scheme is missing, OR any deviation is not separately quantified and explained.

T19  Utilisation of borrowed funds and share premium — Intermediary / Ultimate Beneficiary.
     FAIL IF  : The two-pronged disclosure (funds advanced/loaned/invested in Intermediaries; funds received from Funding Parties — both with the Ultimate Beneficiary representation) is missing. If material amounts exist, the recipient details, amounts, and date of recording should be tabulated.

T20  Crypto / virtual currency.
     FAIL IF  : Disclosure on whether the Company has traded or invested in crypto or virtual currency during the year is missing — including profit/loss on transactions, amount of currency held at year-end, and deposits or advances received from any person for trading or investing in such currency. Affirmative "No transactions" statement is acceptable.

T21  Undisclosed income surrendered.
     TRIGGER  : The notes / tax computation refer to any survey, search, or income-tax assessment.
     FAIL IF  : Disclosure of any transaction not recorded in the books that has been surrendered or disclosed as income during the year in tax assessments under the Income Tax Act 1961 (search under Sec 132, survey under Sec 133A, etc.) is missing, OR if such income exists, treatment in the books is not stated.

T22  Eleven Schedule III ratios + variance reasons.
     FAIL IF  : Any of the following 11 ratios is missing OR prior-year comparative is missing OR the explanation of variance > 25% (current vs prior year) is missing where applicable:
     (i) Current Ratio  (ii) Debt-Equity Ratio  (iii) Debt Service Coverage Ratio
     (iv) Return on Equity Ratio  (v) Inventory Turnover Ratio
     (vi) Trade Receivables Turnover Ratio  (vii) Trade Payables Turnover Ratio
     (viii) Net Capital Turnover Ratio  (ix) Net Profit Ratio
     (x) Return on Capital Employed  (xi) Return on Investment.

T23  Trade Receivables ageing schedule.
     TRIGGER  : Trade Receivables > 0.
     FAIL IF  : Ageing buckets are not in the prescribed format — Less than 6 months / 6 months-1 yr / 1-2 yr / 2-3 yr / More than 3 yr — split into Undisputed-considered-good / Undisputed-considered-doubtful / Disputed-considered-good / Disputed-considered-doubtful, with comparatives.

T24  Trade Payables ageing schedule.
     TRIGGER  : Trade Payables > 0.
     FAIL IF  : Ageing buckets are not — Less than 1 yr / 1-2 yr / 2-3 yr / More than 3 yr — split into MSME / Others / Disputed dues to MSME / Disputed dues to Others, with comparatives.

════════════════════════════════════════════
SECTION C — OTHER MANDATORY SCH III PRESENTATION [HIGH / MEDIUM]
════════════════════════════════════════════

T25  Promoter shareholding disclosure. [HIGH]
     TRIGGER  : The Company is not exempt from this disclosure (i.e., is a normal company).
     FAIL IF  : The note "Shares held by promoters at the end of the year" — with name of promoter, no. of shares, % of total shares, AND % change during the year, with comparatives — is missing or incomplete.

T26  Money received against share warrants. [MEDIUM]
     TRIGGER  : The Balance Sheet shows any line referring to share warrants OR convertibles.
     FAIL IF  : "Money received against share warrants" is not disclosed on the face of the BS as a separate line under Shareholders' Funds (between Reserves & Surplus and Money received against share warrants), with terms of conversion, forfeiture, and number of warrants.

T27  Share application money pending allotment. [MEDIUM]
     TRIGGER  : The notes refer to share application money received but unallotted.
     FAIL IF  : The classification (current vs non-current), refundability, number of shares to be issued, premium, and terms of allotment are not disclosed.

T28  Reserves & Surplus break-up. [HIGH]
     TRIGGER  : Reserves & Surplus > 0.
     FAIL IF  : The reserves are not broken up into the prescribed line items as applicable — Capital Reserve, Capital Redemption Reserve, Securities Premium, Debenture Redemption Reserve, Revaluation Reserve, Share Options Outstanding Account, Other Reserves (specify nature), and Surplus i.e. balance in Statement of P&L.

T29  Capital advances classification. [HIGH]
     TRIGGER  : Capital advances appear in the notes.
     FAIL IF  : Capital advances are shown within Capital Work-in-Progress instead of under Long-term loans and advances. Amended Sch III explicitly requires capital advances under Long-term loans & advances.

T30  Cash & cash equivalents vs Other bank balances. [MEDIUM]
     TRIGGER  : Bank balances or fixed deposits appear under Current Assets.
     FAIL IF  : Fixed deposits with original maturity > 3 months and ≤ 12 months are not split out under "Other bank balances" (separate sub-head from Cash and cash equivalents), OR margin money / lien deposits are not separately disclosed.

T31  Comparative figures and reclassification. [MEDIUM]
     FAIL IF  : Any line on the Balance Sheet, Statement of P&L, or Cash Flow Statement is missing the prior-year comparative figure, OR where current-year presentation differs from prior year, the reclassification footnote is missing.

T32  Rounding-off compliance — Sch III Gen Instr Para 4. [LOW]
     FAIL IF  : The rounding policy is not stated, OR the unit chosen is not in the permitted set:
       Total income < Rs 100 cr   → Hundreds / Thousands / Lakhs / Millions / Decimals.
       Total income ≥ Rs 100 cr   → Lakhs / Millions / Crores / Decimals.
     OR the rounding unit is not consistent across BS, P&L, CFS, and Notes.

T33  Share reconciliation table. [HIGH]
     TRIGGER  : Share Capital > 0.
     FAIL IF  : The Share Capital note does not include a reconciliation of the number of shares outstanding at the beginning AND at the end of the year, showing — opening shares + shares issued during the year + shares bought back during the year + any other movement = closing shares — for each class of shares, with face value disclosed.

T34  Rights, preferences and restrictions on each class of shares. [HIGH]
     TRIGGER  : Share Capital > 0.
     FAIL IF  : For each class of shares, the rights, preferences and restrictions (including restrictions on the distribution of dividends and the repayment of capital) are not disclosed in the Share Capital note.

T35  Shares held by holding / ultimate holding / subsidiaries / associates. [HIGH]
     TRIGGER  : The Company is a subsidiary, OR has a holding company / ultimate holding company.
     FAIL IF  : Shares in the Company held by its holding company or its ultimate holding company, including shares held by subsidiaries or associates of the holding/ultimate holding company in the aggregate, are not disclosed.

T36  Shareholders holding more than 5%. [HIGH]
     TRIGGER  : Share Capital > 0.
     FAIL IF  : The Share Capital note does not list each shareholder holding more than 5% of shares with name + number of shares held, separately for each class of shares.

T37  Shares allotted without payment in cash — last 5 years. [MEDIUM]
     TRIGGER  : Company has been incorporated for ≥ 5 years OR has issued any shares in the preceding 5 years.
     FAIL IF  : Aggregate number and class of shares allotted as fully paid up pursuant to contracts without payment being received in cash, in the preceding 5 years, is not disclosed (an affirmative "nil" statement is acceptable).

T38  Bonus shares allotted — last 5 years. [MEDIUM]
     TRIGGER  : As T37.
     FAIL IF  : Aggregate number and class of shares allotted as fully paid up by way of bonus shares in the preceding 5 years is not disclosed (affirmative "nil" statement is acceptable).

T39  Shares bought back — last 5 years. [MEDIUM]
     TRIGGER  : As T37.
     FAIL IF  : Aggregate number and class of shares bought back in the preceding 5 years is not disclosed (affirmative "nil" statement is acceptable).

T40  Calls unpaid + forfeited shares. [MEDIUM]
     TRIGGER  : Share Capital > 0.
     FAIL IF  : Where calls are unpaid, the amount is not separately disclosed for directors and officers; OR forfeited shares (amount originally paid up) are not separately disclosed where they exist.

T41  Investments — quoted vs unquoted + market value + diminution. [HIGH]
     TRIGGER  : Investments > 0.
     FAIL IF  : Investments are not classified into Quoted and Unquoted; OR market value of quoted investments is not disclosed; OR aggregate provision for diminution in value of investments (with nature/circumstances of impairment) is not disclosed.

T42  Borrowings — secured vs unsecured + nature of security. [HIGH]
     TRIGGER  : Total Borrowings > 0.
     FAIL IF  : Borrowings are not sub-classified into Secured and Unsecured; OR the nature of security (assets charged) is not specified for each secured borrowing.

T43  Borrowings — terms of repayment + default disclosure + guarantees. [HIGH]
     TRIGGER  : Total Borrowings > 0.
     FAIL IF  : For each term loan / bond / debenture, the terms of repayment (period of maturity vs. balance sheet date, number and amount of instalments, applicable rate of interest) are not stated; OR there has been any default in repayment of loans or interest as on the balance sheet date and the period AND amount of default are not specifically disclosed (disclosure required even if remediated before the FS were approved for issue); OR aggregate amount of loans guaranteed by directors or others is not disclosed where applicable; OR debentures are not listed in descending order of maturity / conversion.

T44  Current maturities of long-term debt — classification. [HIGH]
     TRIGGER  : Long-term Borrowings exist.
     FAIL IF  : Current maturities of long-term borrowings are shown under "Other Current Liabilities" instead of under "Short-Term Borrowings" with separate disclosure (the 2021 amendment moved this classification — current maturities now belong under Short-Term Borrowings).

════════════════════════════════════════════
SECTION D — AS COMPLIANCE [HIGH / MEDIUM]
════════════════════════════════════════════

T45  AS-3 Cash Flow Statement — existence. [HIGH]
     TRIGGER  : Company is NOT an OPC / Small Company / Dormant Company.
     FAIL IF  : Cash Flow Statement is missing, OR direct/indirect method is mixed inconsistently, OR cash & cash equivalents are not reconciled to the Balance Sheet.

T46  AS-15(R) actuarial disclosures. [HIGH]
     TRIGGER  : Gratuity, leave encashment, or other defined benefit obligation appears.
     FAIL IF  : Any of these is missing — actuarial assumption table (discount rate, salary escalation, attrition, mortality table), DBO opening-to-closing reconciliation, plan asset reconciliation (if funded), expense recognised in P&L, current vs non-current bifurcation of net liability/asset.

T47  AS-18 Related Party — relationships, transactions, balances. [HIGH]
     TRIGGER  : The notes identify any related parties.
     FAIL IF  : List of relationships and parties is not given, OR transactions in summary by category and party are not given, OR year-end balances (receivable/payable) are not given, OR a blanket "as identified by management" statement substitutes for actual party names.

T48  AS-22 Deferred tax — DTA prudence. [HIGH]
     TRIGGER  : Deferred Tax Asset is recognised AND brought-forward loss / unabsorbed depreciation exists.
     FAIL IF  : The note does NOT assert "virtual certainty supported by convincing evidence" of future taxable income (a higher bar than "reasonable certainty"), OR does not describe the convincing evidence, OR DTA on losses is recognised when only "reasonable certainty" is asserted.

T49  AS-20 EPS. [MEDIUM]
     FAIL IF  : Both Basic and Diluted EPS are not disclosed on the face of the P&L, OR face value of equity share, weighted-average number of shares, and reconciliation of numerator (net profit attributable to equity shareholders) are not in the notes.

T50  AS-29 Provisions, Contingent Liabilities, Capital Commitments. [HIGH]
     FAIL IF  : Contingent liabilities note is missing, OR estimated amounts of contracts remaining to be executed on capital account and not provided for is missing, OR provisions movement (opening/additions/utilised/reversed/closing) for non-routine provisions is missing.

T51  AS-2 Inventory valuation policy. [MEDIUM]
     TRIGGER  : Inventories > 0.
     FAIL IF  : The accounting policy does not state the cost formula (FIFO / Weighted Average / Specific identification) AND the basis (lower of cost or net realisable value).

T52  AS-16 Borrowing costs. [MEDIUM]
     TRIGGER  : Capital Work-in-Progress > 0 OR borrowings exist alongside qualifying assets.
     FAIL IF  : Amount of borrowing costs capitalised on qualifying assets during the year, and the capitalisation rate used, are not disclosed.

T53  AS-3 Cash Flow Statement — classification quality. [HIGH]
     TRIGGER  : Cash Flow Statement is presented.
     FAIL IF  : Any of these — (a) Capital advances (advances for acquisition of PPE / intangibles) are classified under Operating activities (they belong under Investing); OR (b) Proceeds from borrowings and Repayment of borrowings are netted on the face of the CFS (they must be shown gross even when from the same lender); OR (c) Interest accrued but not paid is included within "Changes in working capital" (it is a non-cash add-back, not a working-capital change); OR (d) Difference in foreign exchange on EEFC accounts is not separately reconciled at the bottom of the CFS.

T54  AS-18 Related Party — Parent name + outstanding balances always. [MEDIUM]
     TRIGGER  : The Company has a parent / ultimate parent / Key Managerial Personnel.
     FAIL IF  : Name of the Parent and (where applicable) Ultimate Parent / Next Most Senior Parent is not disclosed even where there have been no transactions during the year; OR balances outstanding at year-end with each related-party category are not separately disclosed alongside the transaction amounts during the year.

════════════════════════════════════════════
SECTION E — COMPANIES ACT / OTHER STATUTES [MEDIUM]
════════════════════════════════════════════

T55  MSMED Act 2006 — Section 22 verbatim six-clause disclosure.
     FAIL IF  : Any of these is missing — (a) principal amount and (b) interest due thereon remaining unpaid to MSME suppliers; (c) interest paid under Sec 16 read with payments made beyond appointed day; (d) interest due and payable for delay; (e) interest accrued and remaining unpaid at year-end; (f) further interest remaining due in succeeding years until actually paid.

T56  Forex Earnings & Outgo — Sec 134(3)(m) read with Rule 8 Companies (Accounts) Rules 2014.
     TRIGGER  : The Company is not a One-Person Company / Small Company / specified exempt entity.
     FAIL IF  : Earnings in foreign currency and Expenditure in foreign currency are not disclosed in the notes for inclusion in the Board's Report.

T57  CSR — Sec 135, including ongoing-project bifurcation. [MEDIUM]
     TRIGGER  : Average Net Profit (3 years) ≥ Rs 5 crore OR Net Worth ≥ Rs 500 crore OR Turnover ≥ Rs 1,000 crore.
     FAIL IF  : Any of the prescribed CSR disclosures is missing — (a) amount required to be spent; (b) amount spent during the year split into "in cash" and "yet to be paid in cash"; (c) shortfall at end of year; (d) total of previous years' shortfall; (e) reason for shortfall; (f) nature of CSR activities; (g) details of related-party transactions in CSR (contribution to a trust controlled by the Company); (h) where the Company has a CSR liability provision, the movement in provision during the year is not shown separately; (i) where there is an ongoing project, amount transferred to the "Unspent CSR Account" within 30 days of FY-end is not disclosed; (j) the disclosure is not split into "ongoing projects" vs "other than ongoing projects".

T58  Dividend disclosure. [LOW]
     TRIGGER  : Dividend has been proposed or declared.
     FAIL IF  : Proposed dividend is provided as a liability instead of being disclosed only in the notes (post-revision to AS-4 effective FY 2016-17), OR arrears of fixed cumulative dividend on preference shares are not disclosed.

T59  Note 1 — Corporate Information. [MEDIUM]
     FAIL IF  : Note 1 is missing or does not state the registered office, nature of business, and CIN.

T60  Note 2 — Significant Accounting Policies presence. [MEDIUM]
     FAIL IF  : Note 2 is missing any of these policies that are relevant to the company — basis of preparation, revenue recognition, depreciation method and rates (with WDV/SLM), foreign currency, employee benefits, leases, taxation, inventories, borrowing costs, impairment, provisions/contingent liabilities, earnings per share.

════════════════════════════════════════════
SECTION F — P&L DISCLOSURE SUB-CLASSIFICATION [HIGH / MEDIUM]
════════════════════════════════════════════

T61  Revenue from operations — three-way bifurcation. [HIGH]
     TRIGGER  : Revenue from Operations > 0.
     FAIL IF  : Revenue from Operations is not bifurcated on the face of the P&L (or in the immediate note) into (a) Sale of products, (b) Sale of services, and (c) Other operating revenues, with comparatives. (For Section 8 companies — Grants or Donations received in addition.)

T62  Other Income — sub-classification. [MEDIUM]
     TRIGGER  : Other Income > 0.
     FAIL IF  : Other Income is not sub-classified into Interest income / Dividend income / Net gain on sale of investments / Net gain on foreign currency transactions and translation / Other non-operating income.

T63  Cost of Materials Consumed — opening + purchases − closing. [MEDIUM]
     TRIGGER  : Cost of Materials Consumed > 0 OR the Company is engaged in manufacturing.
     FAIL IF  : The cost-of-materials-consumed calculation showing Opening Stock + Purchases − Closing Stock is not presented in the relevant note.

T64  Changes in inventories — by category. [MEDIUM]
     TRIGGER  : Inventories > 0 AND the Company carries inventories of more than one type.
     FAIL IF  : Changes in inventories are not separately disclosed for Finished Goods, Work-in-Progress, and Stock-in-trade.

T65  Employee Benefits Expense — sub-split. [HIGH]
     TRIGGER  : Employee Benefits Expense > 0.
     FAIL IF  : Employee Benefits Expense is not sub-classified into (a) Salaries and wages; (b) Contribution to Provident and other funds; (c) Expense on Employee Stock Option Scheme or Employee Stock Purchase Plan (where applicable); (d) Staff welfare expenses.

T66  Finance Costs — sub-split. [HIGH]
     TRIGGER  : Finance Costs > 0.
     FAIL IF  : Finance Costs are not sub-classified into (a) Interest expense; (b) Other borrowing costs; (c) Applicable net gain or loss on foreign currency transactions and translation to the extent regarded as an adjustment to interest cost.

T67  Other Expenses — itemisation per Sch III materiality threshold. [HIGH]
     TRIGGER  : Other Expenses > 0.
     FAIL IF  : Any item of expenditure within "Other Expenses" that exceeds 1% of revenue from operations OR Rs 1,00,000, whichever is higher, is not separately disclosed by nature.

T68  Exceptional / Extraordinary / Prior-period items — separate disclosure. [MEDIUM]
     TRIGGER  : Statement of Profit & Loss is presented.
     FAIL IF  : Where exceptional items, extraordinary items, or prior-period items exist, they are not presented on separate lines on the face of the P&L with a descriptive note.

T69  Auditor's remuneration — six sub-categories per Sch III. [MEDIUM]
     TRIGGER  : Auditor's remuneration appears in the notes.
     FAIL IF  : Auditor's remuneration is not disaggregated into the Sch III mandated categories — (a) as auditor; (b) for taxation matters; (c) for company law matters; (d) for management services; (e) for other services; (f) for reimbursement of expenses. (Plus GST / service tax where separately charged.)

════════════════════════════════════════════
FINAL SELF-REVIEW PASS — perform before returning the JSON:
- Re-read every issue. Drop any that lack an evidenceQuote AND a rupee figure (unless you have explicitly said "Disclosure not located in the document" after a thorough read).
- Drop any issue that conflicts with the DO-NOT-FLAG list.
- Confirm that every issue's severity matches the SEVERITY RUBRIC.
- Confirm sort order: CRITICAL → HIGH → MEDIUM → LOW.
- Return ONLY the JSON object.
════════════════════════════════════════════`;

// ============================================================
// NOTES_DRAFT_PROMPT — produce ONE "Significant Accounting Policies" note
// (Note 2) covering ONLY the policies relevant to the BALANCE SHEET, per
// ICAI best practice (Division I / AS basis).
//
// Design (the optimisation):
//   - A DETERMINISTIC allow-list is computed in JS from keyMetrics, so the
//     model only drafts policies for line items the balance sheet actually
//     carries (PPE/inventory/receivables/borrowings gated on their figures).
//     This keeps the output tight, on-target and fast — no scanning a fixed
//     20-policy menu, no "Not applicable" filler rows.
//   - P&L / pure-disclosure policies are EXCLUDED by construction (revenue
//     recognition, other income, EPS, segment, cash-flow statement,
//     related-party disclosure, CSR, prior-period).
//   - Recognition + measurement focus (what shapes the carrying amount), not
//     disclosure narrative.
// Output JSON shape is unchanged so SuggestedNotesTab + docExport are untouched.
// ============================================================
export const NOTES_DRAFT_PROMPT = (issues, company, metrics) => {
  const m = metrics || {};
  const has = (v) => typeof v === 'number' && Math.abs(v) > 0;
  const hasPPE  = has(m.fixedAssetsLakhs);
  const hasInv  = has(m.inventoriesLakhs);
  const hasTR   = has(m.tradeReceivablesLakhs);
  const hasBorr = has(m.totalBorrowingsLakhs);

  // ── Deterministic allow-list — balance-sheet policies only ──
  // MANDATORY: always drafted (apply to essentially every Indian company FS).
  const mandatory = [
    'Basis of preparation (Indian GAAP / AS notified u/s 133; accrual; historical cost; going concern)',
    'Use of estimates and judgements',
    'Current vs non-current classification and operating cycle',
  ];
  if (hasPPE) {
    mandatory.push('Property, Plant and Equipment and depreciation (AS-10; useful lives per Schedule II, Companies Act 2013)');
    mandatory.push('Capital work-in-progress');
    mandatory.push('Impairment of (non-financial) assets (AS-28)');
  }
  if (hasInv)            mandatory.push('Inventories (AS-2; lower of cost and net realisable value; state the cost formula)');
  if (hasTR)            mandatory.push('Trade receivables and provision for doubtful debts and advances');
  if (hasBorr && hasPPE) mandatory.push('Borrowing costs (AS-16; capitalisation to qualifying assets, else expensed)');
  mandatory.push('Cash and cash equivalents (AS-3 definition)');
  mandatory.push('Employee benefit obligations (AS-15 Revised; defined contribution; defined benefit/gratuity on actuarial valuation; leave benefits)');
  mandatory.push('Provisions, contingent liabilities and contingent assets (AS-29) — recognition basis');
  mandatory.push('Taxes on income — current tax and deferred tax (AS-22; "virtual certainty supported by convincing evidence" for DTA on carry-forward losses / unabsorbed depreciation)');

  // CONDITIONAL: draft ONLY if such a balance exists in the FS (no metric to
  // gate on these, so the model judges from the document). NEVER write
  // "Not applicable" — simply omit the sub-policy if absent.
  const ifPresent = [
    'Intangible assets and amortisation (AS-26)',
    'Investments — current and long-term (AS-13; long-term at cost less other-than-temporary diminution; current at lower of cost or fair value)',
    'Leases (AS-19) — leased assets / lease obligations',
    'Foreign currency monetary items — restatement at closing rate (AS-11)',
    'Government grants related to assets (AS-12)',
  ];

  const mandatoryList = mandatory.map((p, i) => `  ${i + 1}. ${p}`).join('\n');
  const ifPresentList = ifPresent.map((p) => `  - ${p}`).join('\n');

  // Trimmed issues hint — titles only, capped — to flag policy areas the review
  // found weak. Kept light to save tokens; policies are NOT disclosure-driven.
  const issueHint = (issues || [])
    .map((iss) => (iss?.title || '').trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((t) => `  - ${t}`)
    .join('\n');

  return `You are a senior Indian Chartered Accountant drafting the "Significant Accounting Policies" note (Note 2) for ${company?.name || 'the Company'} (CIN: ${company?.cin || '—'}, FY ending ${company?.yearEnd || '—'}), reporting under Schedule III, Division I (Accounting Standards basis).

SCOPE — BALANCE SHEET POLICIES ONLY.
Draft ONLY accounting policies that govern the recognition and MEASUREMENT of balance-sheet items (assets, liabilities, equity). This is a policies note, NOT a disclosures note.
EXCLUDE entirely — do not draft these: revenue recognition (AS-9), other income, earnings per share (AS-20), segment reporting (AS-17), the cash flow statement (AS-3 statement), related-party "disclosure" policy (AS-18), CSR, and prior-period items. (Cash and cash equivalents as a balance-sheet line IS in scope; the cash-flow statement is not.)

MANDATORY sub-policies — draft EVERY one of these, in this order:
${mandatoryList}

CONDITIONAL sub-policies — draft ONLY where the financial statements actually carry such a balance/transaction; otherwise OMIT the sub-policy entirely. Do NOT write "Not applicable":
${ifPresentList}
${issueHint ? `\nSchedule III review flagged these areas as weak — give the corresponding policy extra rigor where it is in scope:\n${issueHint}\n` : ''}
DRAFTING RULES (ICAI best practice)
- ONE note, sub-headings numbered 2.1, 2.2, 2.3 … in sequence; the FIRST sub-policy is "2.1 Basis of preparation".
- Cite the governing AS in brackets at the end of the heading, e.g. "2.4 Impairment of assets (AS-28)".
- Declarative policy prose an Indian audit firm would publish. No hedging ("may", "could").
- Recognition + measurement focus (what determines the carrying amount), not disclosure narrative.
- Use a [BRACKETED CAPS] placeholder ONLY where a genuine preparer choice is required: depreciation method [WDV / SLM — strike one], inventory cost formula [FIFO / WEIGHTED AVERAGE — specify], any [USEFUL_LIVES_OVERRIDE_PER_SCH_II].
- Do NOT invent rupee figures. Do NOT add a company-name header.
- Do NOT include any P&L-only or disclosure-only policy, even if it seems standard.

OUTPUT FORMAT — return ONLY valid JSON (no markdown fences, no commentary):

{
  "accountingPolicies": {
    "noteTitle": "Note 2 — Significant Accounting Policies",
    "introText": "The significant accounting policies relating to the recognition and measurement of assets, liabilities and equity adopted by the Company in the preparation of these financial statements are set out below. These policies have been consistently applied to all periods presented unless otherwise stated.",
    "subPolicies": [
      {
        "heading": "2.1 Basis of preparation",
        "body":    "The financial statements have been prepared in accordance with the Generally Accepted Accounting Principles in India (Indian GAAP) to comply with the Accounting Standards specified under Section 133 of the Companies Act, 2013, read with Rule 7 of the Companies (Accounts) Rules, 2014, and the relevant provisions of the Companies Act, 2013. They have been prepared on an accrual basis under the historical cost convention and on a going-concern basis. The Company has ascertained its operating cycle as 12 months for the purpose of current / non-current classification of assets and liabilities."
      },
      { "heading": "2.2 Use of estimates", "body": "..." }
    ]
  }
}

Each body is one prose paragraph of 40–110 words. No "\\n" inside a body. Emit ONLY the mandatory list plus any in-scope conditional policies — nothing else.`;
};

// CARO_PROMPT is a function that embeds key metrics into the prompt.
// Returns the full user prompt string for the CARO analysis call.
export const CARO_PROMPT = (m, companyName, isFirstYear, natureOfBusiness) =>
  `You are a senior CA reviewer applying CARO 2020 to ${companyName} (nature: ${natureOfBusiness || 'unspecified'}).

Key inputs (Rs in lakhs):
- Paid-up capital + reserves: ${((m.paidUpCapitalLakhs || 0) + (m.reservesLakhs || 0)).toFixed(2)}
- Total borrowings: ${(m.totalBorrowingsLakhs || 0).toFixed(2)}
- Total revenue: ${(m.revenueLakhs || 0).toFixed(2)}
- Holding/sub of public co: ${m.isHoldingOrSubOfPublicCo}
- First year: ${isFirstYear ? 'Yes' : 'No'}
- PBT: ${(m.profitBeforeTaxLakhs || 0).toFixed(2)} | Current tax: ${(m.currentTaxLakhs || 0).toFixed(2)}
- Trade receivables: ${(m.tradeReceivablesLakhs || 0).toFixed(2)} | Fixed assets: ${(m.fixedAssetsLakhs || 0).toFixed(2)}

STEP 1 — Apply CARO 2020 paragraph 1(2)(iv): private company is exempt only if ALL of:
(a) Not holding/sub of public co  (b) Cap+Res ≤ Rs 100L  (c) Borrowings ≤ Rs 100L  (d) Revenue ≤ Rs 1,000L

STEP 2 — Default Annexure A wording is already pre-built in the tool. The defaults assume:
- 3(i): Standard PPE register, physical verification, title deeds in name, no revaluation, no benami
- 3(ii): No inventory; no WC limits >Rs 5 cr
- 3(iii): No investments / guarantees / loans granted
- 3(iv): No Sec 185/186 transactions
- 3(v): No public deposits
- 3(vi): Cost records not specified for Co's products/services
- 3(vii): Statutory dues regularly deposited; no disputed amounts
- 3(viii): No undisclosed income surrendered
- 3(ix): No default; not wilful defaulter; no term loans; no short-term used for long-term
- 3(x): No IPO/FPO; no preferential allotment / private placement
- 3(xi): No fraud; no ADT-4 filed; no whistle-blower complaints
- 3(xii): Not Nidhi
- 3(xiii): Related party txns in compliance with Sec 177/188
- 3(xiv): Internal audit not required under Sec 138
- 3(xv): No non-cash transactions with directors
- 3(xvi): Not NBFC/HFC/CIC; no group CICs
- 3(xvii): No cash losses in current or previous year
- 3(xviii): No resignation of auditor
- 3(xix): No material uncertainty (going concern intact)
- 3(xx): Sec 135 CSR not applicable
- 3(xxi): No CFS / no group CARO qualifications

For each of the 21 paragraphs, set "needsReview": true ONLY if a company-specific fact contradicts the default above. Provide a concise reviewNote citing actual figures (≤ 25 words). Otherwise needsReview: false and reviewNote: "".

Return ONLY valid JSON:
{
  "applicability": {
    "applies": boolean,
    "reasoning": "1-2 sentences",
    "thresholds": [{"test": "string", "result": "Pass|Fail|Unknown", "value": "string"}]
  },
  "clauseStatus": [
    {"paragraph": "3(i)", "needsReview": false, "reviewNote": ""},
    {"paragraph": "3(ii)", "needsReview": false, "reviewNote": ""}
    // ... return one entry for each of 3(i) through 3(xxi)
  ]
}

If CARO does not apply, return clauseStatus: []. Return ONLY the JSON object.`;
