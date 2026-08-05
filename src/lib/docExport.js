// ============ WORD DOCUMENT EXPORT ============
//
// Generates an SA 700 (Revised) compliant Independent Auditor's Report
// using HTML + MSO XML namespaces. The output is a .doc file that opens
// cleanly in Microsoft Word and Google Docs.
//
// Ported verbatim from the source artifact; refactored as a standalone module.

import { formatLongDate, ROMAN_LOWER } from './format.js';

// ---- Section 143(3) static HTML blocks ----

const sec143_3_abcdh_HTML = `
<p style="margin:8pt 0;text-align:justify;">As required by Section 143(3) of the Act, based on our audit, we report that:</p>
<p style="margin:6pt 0 6pt 24pt;text-align:justify;">a) We have sought and obtained all the information and explanations which to the best of our knowledge and belief were necessary for the purposes of our audit;</p>
<p style="margin:6pt 0 6pt 24pt;text-align:justify;">b) In our opinion, proper books of account as required by law have been kept by the Company so far as it appears from our examination of those books;</p>
<p style="margin:6pt 0 6pt 24pt;text-align:justify;">c) The Balance Sheet, the Statement of Profit and Loss and the Cash Flow Statement dealt with by this Report are in agreement with the books of account;</p>
<p style="margin:6pt 0 6pt 24pt;text-align:justify;">d) In our opinion, the aforesaid standalone financial statements comply with the Accounting Standards specified under Section 133 of the Act, read with the Companies (Accounts) Rules, 2014;</p>
<p style="margin:6pt 0 6pt 24pt;text-align:justify;">e) On the basis of the written representations received from the directors as on the balance sheet date and taken on record by the Board of Directors, none of the directors is disqualified as on that date from being appointed as a director in terms of Section 164(2) of the Act;</p>
`;

const sec143_3_g_HTML = `
<p style="margin:6pt 0 6pt 24pt;text-align:justify;">g) With respect to the other matters to be included in the Auditor's Report in accordance with the requirements of Section 197(16) of the Act, as amended: In our opinion and to the best of our information and according to the explanations given to us, the Company being a private limited company, the provisions of Section 197 of the Act are not applicable to the Company;</p>
`;

const sec143_3_f_EXEMPT_HTML = `
<p style="margin:6pt 0 6pt 24pt;text-align:justify;">f) Reporting under Section 143(3)(i) of the Act is not applicable to the Company as it is a private limited company having turnover less than Rs. 50 crores as per the latest audited financial statements and aggregate borrowings from banks, financial institutions or any body corporate at any point of time during the financial year of less than Rs. 25 crores;</p>
`;

const sec143_3_f_APPLIES_HTML = `
<p style="margin:6pt 0 6pt 24pt;text-align:justify;">f) With respect to the adequacy of the internal financial controls with reference to financial statements of the Company and the operating effectiveness of such controls, refer to our separate Report in <strong>"Annexure B"</strong>. Our report expresses an unmodified opinion on the adequacy and operating effectiveness of the Company's internal financial controls with reference to financial statements;</p>
`;

const caroReferenceHTML = `
<p style="margin:10pt 0;text-align:justify;">As required by the Companies (Auditor's Report) Order, 2020 ("the Order"), issued by the Central Government in terms of Section 143(11) of the Act, we give in <strong>"Annexure A"</strong> a statement on the matters specified in paragraphs 3 and 4 of the Order, to the extent applicable.</p>
`;

// ---- Escaping ----
// The .doc payload is HTML. Every value that originates from the reviewer
// (Rule 11 free text, firm/partner details) or from the model (CARO remarks)
// MUST be escaped: a bare '<' in something like "claims < Rs 50 lakh" swallows
// the rest of the markup and Word opens a truncated or malformed report.
// Only the literal template strings in this file may contain live tags.
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- Shared Word shell ----
// Real Word page geometry (A4, 1in top/bottom, 1.25in binding edge), Print
// Layout on open, and a "Page X of Y" footer via MSO field codes. Every value
// below is a static literal — never interpolated — so this shell can never
// leak the string "undefined" into a report.
const WORD_CSS = `
<style>
  @page WordSection1 {
    size: 595.3pt 841.9pt;
    margin: 72.0pt 63.0pt 72.0pt 90.0pt;
    mso-header-margin: 35.4pt;
    mso-footer-margin: 35.4pt;
    mso-footer: f1;
    mso-paper-source: 0;
  }
  div.WordSection1 { page: WordSection1; }
  body { font-family: 'Times New Roman', serif; font-size: 11pt; line-height: 1.4; color: #000; }
  h1, h2, h3 { font-family: 'Times New Roman', serif; mso-pagination: widow-orphan keep-with-next; page-break-after: avoid; }
  p { margin: 6pt 0; text-align: justify; mso-pagination: widow-orphan; }
  table.sig-block { page-break-inside: avoid; }
  p.MsoFooter { margin: 0; text-align: center; font-size: 9pt; }
</style>
`;

// Google Docs and browsers ignore the [if gte mso 9] conditional comment
// entirely and drop this div, so no "Page 1 of 1" leaks into the visible
// body outside Word. Inside Word, the PAGE / NUMPAGES field codes update live.
const WORD_FOOTER = `
<!--[if gte mso 9]>
<div id="f1" style="mso-element:footer">
<p class="MsoFooter">Page <span style="mso-element:field-begin"></span>PAGE<span style="mso-element:field-separator"></span><span style="mso-element:field-end"></span> of <span style="mso-element:field-begin"></span>NUMPAGES<span style="mso-element:field-separator"></span><span style="mso-element:field-end"></span></p>
</div>
<![endif]-->
`;

function wordShell(title, bodyHtml) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
</w:WordDocument>
</xml>
<![endif]-->
${WORD_CSS}
</head>
<body>
<div class="WordSection1">
${bodyHtml}
</div>
${WORD_FOOTER}
</body>
</html>`;
}

// ---- Rule 11 builder ----
// Renders multi-paragraph text safely by splitting on blank lines.
function renderParagraphs(text, indent = '48pt') {
  if (!text) return '';
  return text
    .split(/\n{2,}/)              // blank-line splits
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p style="margin:5pt 0 5pt ${indent};text-align:justify;">${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

const buildRule11HTML = (rf) => {
  // (e) — use editable text if present, else the standard three-part default.
  const e_text = rf.rule11e_text && rf.rule11e_text.trim().length > 0
    ? rf.rule11e_text
    : `(a) The Management has represented that, to the best of its knowledge and belief, no funds (which are material either individually or in the aggregate) have been advanced or loaned or invested (either from borrowed funds or share premium or any other sources or kind of funds) by the Company to or in any other person(s) or entity(ies), including foreign entities ("Intermediaries"), with the understanding, whether recorded in writing or otherwise, that the Intermediary shall, whether, directly or indirectly lend or invest in other persons or entities identified in any manner whatsoever by or on behalf of the Company ("Ultimate Beneficiaries") or provide any guarantee, security or the like on behalf of the Ultimate Beneficiaries;

(b) The Management has represented that, to the best of its knowledge and belief, no funds (which are material either individually or in the aggregate) have been received by the Company from any person(s) or entity(ies), including foreign entities ("Funding Parties"), with the understanding, whether recorded in writing or otherwise, that the Company shall, whether, directly or indirectly, lend or invest in other persons or entities identified in any manner whatsoever by or on behalf of the Funding Party ("Ultimate Beneficiaries") or provide any guarantee, security or the like on behalf of the Ultimate Beneficiaries;

(c) Based on the audit procedures performed that have been considered reasonable and appropriate in the circumstances, nothing has come to our notice that has caused us to believe that the representations under sub-clauses (a) and (b) above contain any material misstatement.`;

  // (g) — prefer user-edited text, otherwise build from software name.
  const g_text = rf.rule11g_text && rf.rule11g_text.trim().length > 0
    ? rf.rule11g_text.replaceAll('[SOFTWARE]', rf.accountingSoftware || '[SOFTWARE]')
    : `Based on our examination, which included test checks, the Company has used ${rf.accountingSoftware} as its accounting software for maintaining its books of account, which has a feature of recording audit trail (edit log) facility and the same has operated throughout the year for all relevant transactions recorded in the software. Further, during the course of our audit, we did not come across any instance of the audit trail feature being tampered with. The audit trail has been preserved by the Company as per the statutory requirements for record retention.`;

  return `
<p style="margin:8pt 0 6pt 24pt;text-align:justify;">h) With respect to the other matters to be included in the Auditor's Report in accordance with Rule 11 of the Companies (Audit and Auditors) Rules, 2014, as amended, in our opinion and to the best of our information and according to the explanations given to us:</p>

<p style="margin:5pt 0 5pt 48pt;text-align:justify;">i. ${escapeHtml(rf.rule11a_litigation)}</p>

<p style="margin:5pt 0 5pt 48pt;text-align:justify;">ii. ${escapeHtml(rf.rule11b_longTermContracts)}</p>

<p style="margin:5pt 0 5pt 48pt;text-align:justify;">iii. ${escapeHtml(rf.rule11c_iepf)}</p>

<p style="margin:5pt 0 5pt 48pt;text-align:justify;font-weight:bold;">iv. (Ultimate Beneficiary representation)</p>
${renderParagraphs(e_text)}

<p style="margin:5pt 0 5pt 48pt;text-align:justify;">v. ${escapeHtml(rf.rule11f_dividend)}</p>

<p style="margin:5pt 0 5pt 48pt;text-align:justify;font-weight:bold;">vi. (Reporting on audit trail under Rule 11(g))</p>
${renderParagraphs(g_text)}
`;
};

// ---- Annexure A: CARO 2020 ----
const buildAnnexureA = (caro, companyName) => {
  if (!caro?.applicability?.applies) return '';
  const clauses = caro.clauses || [];
  return `
    <br clear="all" style="page-break-before:always" />
    <h2 style="font-family:'Times New Roman',serif;font-size:14pt;font-weight:bold;text-align:center;margin:24pt 0 8pt;page-break-before:always;">ANNEXURE A TO THE INDEPENDENT AUDITOR'S REPORT</h2>
    <p style="text-align:center;font-style:italic;margin:0 0 6pt;">(Referred to in paragraph under 'Report on Other Legal and Regulatory Requirements' section of our report of even date)</p>
    <p style="text-align:center;font-weight:bold;margin:0 0 18pt;">To the Members of ${escapeHtml(companyName)}</p>

    <p style="text-align:justify;margin:8pt 0;">In terms of the information and explanations sought by us and given by the Company and the books of account and records examined by us in the normal course of audit, and to the best of our knowledge and belief, we state that:</p>

    ${clauses.map((c, idx) => `
      <p style="margin:14pt 0 6pt 0;text-align:justify;font-weight:bold;">
        ${ROMAN_LOWER[idx] || (idx + 1)}) ${escapeHtml(c.topic)} <span style="font-weight:normal;font-style:italic;color:#444;">[${escapeHtml(c.paragraph)}]</span>
      </p>
      <div style="margin:0 0 8pt 24pt;text-align:justify;white-space:pre-line;line-height:1.5;">${escapeHtml(c.remark)}</div>
    `).join('')}
  `;
};

// ---- Annexure B: IFCoFR long-form per ICAI Guidance Note ----
const buildAnnexureB = (companyName) => `
  <br clear="all" style="page-break-before:always" />
  <h2 style="font-family:'Times New Roman',serif;font-size:14pt;font-weight:bold;text-align:center;margin:24pt 0 8pt;page-break-before:always;">ANNEXURE B TO THE INDEPENDENT AUDITOR'S REPORT</h2>
  <p style="text-align:center;font-style:italic;margin:0 0 6pt;">(Referred to in paragraph (f) under 'Report on Other Legal and Regulatory Requirements' section of our report of even date)</p>
  <p style="text-align:center;font-weight:bold;margin:0 0 18pt;">Report on the Internal Financial Controls with reference to financial statements under Clause (i) of Sub-section 3 of Section 143 of the Companies Act, 2013 ("the Act")</p>

  <p style="margin:10pt 0;text-align:justify;">We have audited the internal financial controls with reference to financial statements of <strong>${escapeHtml(companyName)}</strong> ("the Company") as of the balance sheet date in conjunction with our audit of the standalone financial statements of the Company for the year ended on that date.</p>

  <h3 style="font-size:12pt;font-weight:bold;margin:14pt 0 4pt;">Management's Responsibility for Internal Financial Controls</h3>
  <p style="margin:6pt 0;text-align:justify;">The Company's Management is responsible for establishing and maintaining internal financial controls based on the internal control with reference to financial statements criteria established by the Company considering the essential components of internal control stated in the Guidance Note on Audit of Internal Financial Controls Over Financial Reporting issued by the Institute of Chartered Accountants of India ("the ICAI"). These responsibilities include the design, implementation and maintenance of adequate internal financial controls that were operating effectively for ensuring the orderly and efficient conduct of its business, including adherence to the Company's policies, the safeguarding of its assets, the prevention and detection of frauds and errors, the accuracy and completeness of the accounting records, and the timely preparation of reliable financial information, as required under the Act.</p>

  <h3 style="font-size:12pt;font-weight:bold;margin:14pt 0 4pt;">Auditor's Responsibility</h3>
  <p style="margin:6pt 0;text-align:justify;">Our responsibility is to express an opinion on the Company's internal financial controls with reference to financial statements based on our audit. We conducted our audit in accordance with the Guidance Note on Audit of Internal Financial Controls Over Financial Reporting (the "Guidance Note") issued by the ICAI and the Standards on Auditing prescribed under Section 143(10) of the Act, to the extent applicable to an audit of internal financial controls. Those Standards and the Guidance Note require that we comply with ethical requirements and plan and perform the audit to obtain reasonable assurance about whether adequate internal financial controls with reference to financial statements were established and maintained and whether such controls operated effectively in all material respects.</p>
  <p style="margin:6pt 0;text-align:justify;">Our audit involves performing procedures to obtain audit evidence about the adequacy of the internal financial controls with reference to financial statements and their operating effectiveness. Our audit of internal financial controls with reference to financial statements included obtaining an understanding of such internal financial controls, assessing the risk that a material weakness exists, and testing and evaluating the design and operating effectiveness of internal control based on the assessed risk. The procedures selected depend on the auditor's judgement, including the assessment of the risks of material misstatement of the financial statements, whether due to fraud or error.</p>
  <p style="margin:6pt 0;text-align:justify;">We believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our audit opinion on the Company's internal financial controls with reference to financial statements.</p>

  <h3 style="font-size:12pt;font-weight:bold;margin:14pt 0 4pt;">Meaning of Internal Financial Controls with reference to Financial Statements</h3>
  <p style="margin:6pt 0;text-align:justify;">A company's internal financial control with reference to financial statements is a process designed to provide reasonable assurance regarding the reliability of financial reporting and the preparation of financial statements for external purposes in accordance with generally accepted accounting principles. A company's internal financial control with reference to financial statements includes those policies and procedures that (1) pertain to the maintenance of records that, in reasonable detail, accurately and fairly reflect the transactions and dispositions of the assets of the company; (2) provide reasonable assurance that transactions are recorded as necessary to permit preparation of financial statements in accordance with generally accepted accounting principles, and that receipts and expenditures of the company are being made only in accordance with authorisations of management and directors of the company; and (3) provide reasonable assurance regarding prevention or timely detection of unauthorised acquisition, use, or disposition of the company's assets that could have a material effect on the financial statements.</p>

  <h3 style="font-size:12pt;font-weight:bold;margin:14pt 0 4pt;">Inherent Limitations of Internal Financial Controls with reference to Financial Statements</h3>
  <p style="margin:6pt 0;text-align:justify;">Because of the inherent limitations of internal financial controls with reference to financial statements, including the possibility of collusion or improper management override of controls, material misstatements due to error or fraud may occur and not be detected. Also, projections of any evaluation of the internal financial controls with reference to financial statements to future periods are subject to the risk that the internal financial control with reference to financial statements may become inadequate because of changes in conditions, or that the degree of compliance with the policies or procedures may deteriorate.</p>

  <h3 style="font-size:12pt;font-weight:bold;margin:14pt 0 4pt;">Opinion</h3>
  <p style="margin:6pt 0;text-align:justify;">In our opinion, to the best of our information and according to the explanations given to us, the Company has, in all material respects, an adequate internal financial controls system with reference to financial statements and such internal financial controls with reference to financial statements were operating effectively as at the balance sheet date, based on the criteria for internal financial control with reference to financial statements established by the Company considering the essential components of internal control stated in the Guidance Note on Audit of Internal Financial Controls Over Financial Reporting issued by the ICAI.</p>
`;

// ---- Signature block ----
const buildSignatureBlockHTML = (rf) => `
  <table class="sig-block" style="width:100%;margin-top:36pt;border-collapse:collapse;page-break-inside:avoid;">
    <tr style="page-break-inside:avoid;">
      <td style="width:50%;vertical-align:top;padding:0;">
        <p style="margin:0;font-weight:bold;">For ${escapeHtml(rf.firmName)}</p>
        <p style="margin:2pt 0;">Chartered Accountants</p>
        <p style="margin:2pt 0;">Firm Registration Number: ${escapeHtml(rf.firmFRN)}</p>
        <br/><br/><br/>
        <p style="margin:0;font-weight:bold;">${escapeHtml(rf.partnerName)}</p>
        <p style="margin:2pt 0;">${escapeHtml(rf.partnerDesignation)}</p>
        <p style="margin:2pt 0;">Membership Number: ${escapeHtml(rf.membershipNo)}</p>
        <p style="margin:2pt 0;">UDIN: ${rf.udin ? escapeHtml(rf.udin) : '__________________'}</p>
      </td>
      <td style="width:50%;vertical-align:top;padding:0;text-align:right;">
        <p style="margin:0;">Place: ${escapeHtml(rf.place)}</p>
        <p style="margin:2pt 0;">Date: ${formatLongDate(rf.reportDate)}</p>
      </td>
    </tr>
  </table>
`;

// ---- Full Report HTML ----
export function buildReportHTML(analysis, caro, rf, ifcofrApplies) {
  // A partially-extracted or imported engagement can arrive without `company`.
  // Fall back to placeholders rather than throwing — a report with "[Company
  // Name]" in it is fixable by the reviewer; a crashed click is not.
  const co         = analysis?.company || {};
  const coNameRaw  = co.name || '[Company Name]';   // annexure builders escape it themselves
  const coName     = escapeHtml(coNameRaw);
  const yearEnd    = escapeHtml(co.yearEnd || '31 March, 20YY');
  const caroApplies = !!caro?.applicability?.applies;

  const main = `
    <h1 style="font-size:14pt;font-weight:bold;text-align:center;margin:0 0 12pt;text-decoration:underline;">INDEPENDENT AUDITOR'S REPORT</h1>
    <p style="font-weight:bold;margin:12pt 0 6pt;">To the Members of ${coName},</p>

    <h2 style="font-size:13pt;font-weight:bold;margin:16pt 0 6pt;">Report on the Audit of the Standalone Financial Statements</h2>

    <h3 style="font-size:12pt;font-weight:bold;margin:12pt 0 4pt;">Opinion</h3>
    <p style="text-align:justify;">We have audited the accompanying standalone financial statements of <strong>${coName}</strong> ("the Company"), which comprise the Balance Sheet as at ${yearEnd}, the Statement of Profit and Loss and the Cash Flow Statement for the year then ended, and notes to the financial statements, including a summary of significant accounting policies and other explanatory information.</p>
    <p style="text-align:justify;">In our opinion and to the best of our information and according to the explanations given to us, the aforesaid standalone financial statements give the information required by the Companies Act, 2013 ("the Act") in the manner so required and give a true and fair view in conformity with the accounting principles generally accepted in India, of the state of affairs of the Company as at ${yearEnd}, and its profit/(loss) and its cash flows for the year ended on that date.</p>

    <h3 style="font-size:12pt;font-weight:bold;margin:12pt 0 4pt;">Basis for Opinion</h3>
    <p style="text-align:justify;">We conducted our audit of the standalone financial statements in accordance with the Standards on Auditing specified under Section 143(10) of the Act ("SAs"). Our responsibilities under those Standards are further described in the <em>Auditor's Responsibilities for the Audit of the Standalone Financial Statements</em> section of our report. We are independent of the Company in accordance with the Code of Ethics issued by the Institute of Chartered Accountants of India ("ICAI") together with the ethical requirements that are relevant to our audit of the standalone financial statements under the provisions of the Act and the Rules made thereunder, and we have fulfilled our other ethical responsibilities in accordance with these requirements and the ICAI's Code of Ethics. We believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our audit opinion on the standalone financial statements.</p>

    <h3 style="font-size:12pt;font-weight:bold;margin:12pt 0 4pt;">Information Other than the Standalone Financial Statements and Auditor's Report Thereon</h3>
    <p style="text-align:justify;">The Company's Board of Directors is responsible for the preparation of the other information. The other information comprises the information included in the Board's Report including Annexures to the Board's Report, but does not include the standalone financial statements and our auditor's report thereon. Our opinion on the standalone financial statements does not cover the other information and we do not express any form of assurance conclusion thereon. In connection with our audit of the standalone financial statements, our responsibility is to read the other information and, in doing so, consider whether the other information is materially inconsistent with the standalone financial statements or our knowledge obtained during the course of our audit, or otherwise appears to be materially misstated. If, based on the work we have performed, we conclude that there is a material misstatement of this other information, we are required to report that fact. We have nothing to report in this regard.</p>

    <h3 style="font-size:12pt;font-weight:bold;margin:12pt 0 4pt;">Responsibilities of Management and Those Charged with Governance for the Standalone Financial Statements</h3>
    <p style="text-align:justify;">The Company's Board of Directors is responsible for the matters stated in Section 134(5) of the Act with respect to the preparation of these standalone financial statements that give a true and fair view of the financial position, financial performance and cash flows of the Company in accordance with the accounting principles generally accepted in India, including the Accounting Standards specified under Section 133 of the Act. This responsibility also includes maintenance of adequate accounting records in accordance with the provisions of the Act for safeguarding of the assets of the Company and for preventing and detecting frauds and other irregularities; selection and application of appropriate accounting policies; making judgements and estimates that are reasonable and prudent; and design, implementation and maintenance of adequate internal financial controls, that were operating effectively for ensuring the accuracy and completeness of the accounting records, relevant to the preparation and presentation of the standalone financial statements that give a true and fair view and are free from material misstatement, whether due to fraud or error.</p>
    <p style="text-align:justify;">In preparing the standalone financial statements, management is responsible for assessing the Company's ability to continue as a going concern, disclosing, as applicable, matters related to going concern and using the going concern basis of accounting unless management either intends to liquidate the Company or to cease operations, or has no realistic alternative but to do so. Those Board of Directors are also responsible for overseeing the Company's financial reporting process.</p>

    <h3 style="font-size:12pt;font-weight:bold;margin:12pt 0 4pt;">Auditor's Responsibilities for the Audit of the Standalone Financial Statements</h3>
    <p style="text-align:justify;">Our objectives are to obtain reasonable assurance about whether the standalone financial statements as a whole are free from material misstatement, whether due to fraud or error, and to issue an auditor's report that includes our opinion. Reasonable assurance is a high level of assurance, but is not a guarantee that an audit conducted in accordance with SAs will always detect a material misstatement when it exists. Misstatements can arise from fraud or error and are considered material if, individually or in the aggregate, they could reasonably be expected to influence the economic decisions of users taken on the basis of these standalone financial statements.</p>
    <p style="text-align:justify;">As part of an audit in accordance with SAs, we exercise professional judgement and maintain professional skepticism throughout the audit. We also identify and assess the risks of material misstatement of the standalone financial statements, whether due to fraud or error; obtain an understanding of internal control relevant to the audit in order to design audit procedures that are appropriate in the circumstances; evaluate the appropriateness of accounting policies used and the reasonableness of accounting estimates and related disclosures made by management; conclude on the appropriateness of management's use of the going concern basis of accounting; and evaluate the overall presentation, structure and content of the standalone financial statements, including the disclosures, and whether the standalone financial statements represent the underlying transactions and events in a manner that achieves fair presentation.</p>
    <p style="text-align:justify;">We communicate with those charged with governance regarding, among other matters, the planned scope and timing of the audit and significant audit findings, including any significant deficiencies in internal control that we identify during our audit.</p>

    <h2 style="font-size:13pt;font-weight:bold;margin:18pt 0 6pt;">Report on Other Legal and Regulatory Requirements</h2>

    ${caroApplies ? caroReferenceHTML : ''}

    ${sec143_3_abcdh_HTML}

    ${ifcofrApplies ? sec143_3_f_APPLIES_HTML : sec143_3_f_EXEMPT_HTML}

    ${sec143_3_g_HTML}

    ${buildRule11HTML(rf)}

    ${buildSignatureBlockHTML(rf)}
  `;

  const annexA = caroApplies  ? buildAnnexureA(caro, coNameRaw) : '';
  const annexB = ifcofrApplies ? buildAnnexureB(coNameRaw)       : '';

  return wordShell(`Independent Auditor's Report — ${coName}`, main + annexA + annexB);
}

export function downloadAsWord(html, filename) {
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================
// SUGGESTED NOTES — Word export
// ============================================================
// Builds a clean Word document with one heading per drafted note and
// the noteText body. Newlines in noteText become <br/> and pipe-tables
// are kept as monospace blocks (Word renders monospace tables passably).
// ============================================================
function noteBodyToHtml(noteText) {
  if (!noteText) return '';
  // Detect any pipe-table-ish blocks and render them in monospace verbatim;
  // wrap everything else as paragraphs.
  const lines = String(noteText).split(/\r?\n/);
  let html = '';
  let buf = [];
  let inMono = false;

  const flushBuf = () => {
    if (buf.length === 0) return;
    if (inMono) {
      html += `<pre style="font-family:'Courier New',monospace;font-size:10pt;background:#f8f8f5;border:1px solid #e8e1d2;padding:8pt;white-space:pre-wrap;">${escapeHtml(buf.join('\n'))}</pre>`;
    } else {
      const paragraph = buf.join(' ').trim();
      if (paragraph) html += `<p style="margin:6pt 0;text-align:justify;">${escapeHtml(paragraph)}</p>`;
    }
    buf = [];
  };

  for (const line of lines) {
    const isTableLine = /^\s*\|/.test(line);
    if (isTableLine !== inMono) {
      flushBuf();
      inMono = isTableLine;
    }
    if (line.trim() === '' && !inMono) {
      flushBuf();
    } else {
      buf.push(line);
    }
  }
  flushBuf();
  return html;
}

/**
 * Build and download a Word document containing the drafted Significant
 * Accounting Policies note (single comprehensive note).
 *
 * @param {object} draftedPolicy - { noteTitle, introText, subPolicies: [{heading, body}] }
 * @param {object} company       - analysis.company
 * @param {object} reportFields  - { firmName, partnerName, ... }
 */
export function downloadAccountingPoliciesWord(draftedPolicy, company, reportFields = {}) {
  const safeName = (company?.name || 'Company')
    .replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);
  const { noteTitle, introText, subPolicies = [] } = draftedPolicy || {};

  const subHtml = subPolicies.map((p) => `
    <h3 style="font-size:12pt;font-weight:bold;margin:14pt 0 4pt;color:#1a3d2e;">
      ${escapeHtml(p.heading || '')}
    </h3>
    ${noteBodyToHtml(p.body || '')}
  `).join('');

  const title = `${escapeHtml(noteTitle || 'Significant Accounting Policies')} — ${escapeHtml(company?.name || 'Company')}`;

  const body = `
  <h1 style="font-size:14pt;font-weight:bold;text-align:center;margin:0 0 6pt;text-decoration:underline;">
    ${escapeHtml(noteTitle || 'Note 2 — Significant Accounting Policies')}
  </h1>
  <p style="text-align:center;font-style:italic;margin:0 0 6pt;">${escapeHtml(company?.name || 'Company')}</p>
  <p style="text-align:center;margin:0 0 18pt;font-size:10pt;color:#5c5e58;">
    Drafted for review pursuant to the Schedule III (Division I) substantive review.<br/>
    ${reportFields.firmName ? escapeHtml(reportFields.firmName) + ' · ' : ''}${reportFields.firmFRN ? 'FRN ' + escapeHtml(reportFields.firmFRN) : ''}
  </p>
  ${introText ? `<p style="margin:8pt 0;text-align:justify;">${escapeHtml(introText)}</p>` : ''}
  ${subHtml || '<p><em>No sub-policies drafted.</em></p>'}
  <hr style="margin-top:24pt;border:none;border-top:1px solid #d4cab4;"/>
  <p style="margin:10pt 0;text-align:justify;font-style:italic;color:#5c5e58;font-size:10pt;">
    The policy drafts above are AI-generated suggestions in standard Schedule III wording. Verify every accounting policy choice, every cited Accounting Standard, and every fact against the Company\'s actual practices before adopting in the financial statements. Placeholders shown in [BRACKETED CAPS] are to be selected or filled by the preparer.
  </p>
  `;

  const html = wordShell(title, body);

  downloadAsWord(html, `${safeName}_Accounting_Policies_Note.doc`);
}

/**
 * Convenience wrapper — computes ifcofrApplies and triggers download.
 */
export function generateReport(analysis, caro, reportFields) {
  const ifcofrApplies = (analysis.keyMetrics?.revenueLakhs || 0) >= 5000;
  const html = buildReportHTML(analysis, caro, reportFields, ifcofrApplies);
  const safeName = (analysis.company?.name || 'Company')
    .replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);
  downloadAsWord(html, `${safeName}_Independent_Auditors_Report.doc`);
}
