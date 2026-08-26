import { complete } from '../lib/llm.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { inputText, tone, skill, confidence, personContext, mode } = req.body || {}

  if (!inputText || !inputText.trim()) {
    return res.status(400).json({ error: 'Please enter your feedback notes before generating.' })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured.' })
  }

  // ── The sharpening check ────────────────────────────────────────────
  // Vague notes produce vague feedback, however good the main prompt is.
  // This runs first, as a separate lightweight call, and offers the manager
  // a sharper version they can accept, edit, or ignore.
  if (mode === 'check') {
    const checkPrompt = `You are reviewing a manager's feedback notes before they generate developmental feedback.

THE MANAGER'S NOTES:
${inputText.trim()}

Decide whether the notes are specific enough to produce feedback that would be useful to the person receiving it.

The notes are TOO VAGUE if:
- They name a trait rather than a behaviour ("she lacks confidence", "he is disorganised")
- They describe no particular occasion, piece of work, or moment
- They could be said to almost anyone
- The person could not tell, from the feedback, what to do differently

The notes are SPECIFIC ENOUGH if:
- They name at least one actual occasion, incident, account or piece of work, even in shorthand. A named client, project or event counts on its own. "The Givaudan PO went to the wrong person" is specific enough.
- They point at a behaviour rather than a character judgement
- There is something the person could act on

Default to PASS. Only FAIL when there is nothing but a character judgement with no
incident attached, such as "she lacks confidence" or "he is disorganised" and nothing
else. If the notes contain both a trait and an incident, that is a PASS. The incident
carries it, and the manager does not need a lecture about the trait.

ABSOLUTE RULE. These notes are about a real person, and what comes out of this tool
ends up in a record that person can ask to read. Never invent a fact. Not a date, not
a name, not a number, not a place, not an outcome, not a line of context. If a detail
is missing, ask for it in square brackets. An invented detail is worse than a vague
note, because the person will know it is wrong and will stop believing the rest of the
conversation.

Respond in EXACTLY this format and nothing else:

STATUS: [PASS or FAIL]
REASON: [One plain sentence. If FAIL, say what is missing.]
SHARPENED: [If FAIL, rewrite the notes using ONLY the facts the manager has given you. Where a detail is missing, write a short question in square brackets for the manager to answer, such as [when did this happen?] or [what did it cost the team?]. Tighten their language and leave their judgement intact. If PASS, repeat the notes unchanged. Give it as a single short paragraph and write nothing after it.]`

    // Never block the manager on the check. If anything fails, let them through:
    // a sharpening suggestion is worth having and worth nothing if it stops work.
    const check = await complete({
      messages: [{ role: 'user', content: checkPrompt }],
      maxTokens: 4000,
      temperature: 0.3,
      fast: true
    })
    return res.status(200).json({ text: check.ok && check.text ? check.text : 'STATUS: PASS' })
  }

  // ── The reframe ─────────────────────────────────────────────────────
  // Managers write feedback notes when they are annoyed. The original
  // Feedback Ignite turned "you're an arrogant twat" into "your confidence
  // can sometimes come across as arrogance" without losing a word of the
  // message, and that was the most valuable thing it did.
  //
  // It works because of one rule: every criticised behaviour is a strength
  // overplayed or underplayed. Arrogance is confidence without empathy.
  // Lateness sits next to the commitment that keeps someone working late.
  // The strength in the opening is not invented to sweeten the pill, it is
  // the same trait seen from the other end, which is why it reads as true.
  //
  // This runs on the quick model, server side, and the manager never sees
  // it. It changes what the writer is working from, not what the writer does.
  const reframePrompt = `A manager has written rough notes before giving feedback. They may be
angry, blunt, or written as a verdict about the person rather than a description of what happened.
Your job is to read through the heat to what is underneath.

THE MANAGER'S NOTES:
${inputText.trim()}

ABSOLUTE RULE. Never add a fact. Not a date, not a name, not a number, not a place, not an
incident, not an outcome. You are re-describing what the manager already wrote, not supplying
what they left out. An invented detail is worse than a vague note, because the person will know
it is wrong and will stop believing the rest of the conversation.

Two more rules that matter as much.

Turn character into behaviour. A verdict about who someone is ("arrogant", "lazy", "difficult")
becomes a description of what they do and the effect it has. Keep the substance. "Arrogant" does
not become "spirited". It becomes confidence that lands as arrogance, which is the same message
in words a person can act on.

Find the strength the behaviour is an over-play or under-play of, if there is one. Confidence
overplayed reads as arrogance. Care for detail overplayed reads as slowness. Modesty overplayed
reads as failing to step up. Pace overplayed reads as carelessness.

Often there is no strength there at all. A person who is repeatedly late, absent, or missing
deadlines is not over-playing anything, they are missing a standard. Naming "drive" or
"commitment" in that gap would be an invented fact wearing a compliment's clothes, and the
ABSOLUTE RULE covers it. When you cannot name a strength out of the manager's own material,
write none. Never reach for one.

Respond in EXACTLY this format and nothing else:

BEHAVIOUR: [What the person actually does, observable, in one plain sentence. No judgement words.]
STRENGTH: [The strength this behaviour is an over-play or under-play of, in a few words. If there is none in the manager's material, write exactly: none]
EFFECT: [What it costs, for the work or the people around them, in one plain sentence. If the manager did not say, write: not stated.]
SEVERITY: [DEVELOPMENTAL if this is ordinary growth. CORRECTIVE if a standard is being missed and must change. FORMAL if the manager has stated a consequence, a deadline for improvement, or a disciplinary process.]`

  let reframed = null
  const reframeRes = await complete({
    messages: [{ role: 'user', content: reframePrompt }],
    maxTokens: 4000,
    fast: true
  })

  if (reframeRes.ok && reframeRes.text) {
    const grab = (label) => {
      const m = reframeRes.text.match(new RegExp(label + ':\\s*([^\\n]+)'))
      return m ? m[1].trim() : ''
    }
    const behaviour = grab('BEHAVIOUR')
    const strengthRaw = grab('STRENGTH')
    // 'none' is a valid, and often the correct, answer. A missed standard is
    // not an over-played strength, and a required field will invent one to
    // fill itself. Behaviour is the field that has to come back.
    const strength = /^(none|n\/?a|not stated|-|—)$/i.test(strengthRaw) ? '' : strengthRaw
    if (behaviour) {
      reframed = {
        behaviour,
        strength,
        effect: grab('EFFECT'),
        severity: (grab('SEVERITY') || 'DEVELOPMENTAL').toUpperCase(),
      }
    }
  }

  // Never block the manager on the reframe. If it fails, the writer works
  // from the raw notes, which is where it was before this existed.
  const severity = reframed?.severity || 'DEVELOPMENTAL'

  const isFormal = severity === 'FORMAL'

  const SEVERITY_RULE = {
    DEVELOPMENTAL: 'This is ordinary development. Write it as an opportunity they have earned.',
    CORRECTIVE: 'A standard is being missed. Name the standard plainly and be unambiguous that it has to change. Warmth in the language, no softness in the message.',
    FORMAL: 'The manager has stated a consequence, a deadline or a formal process. It goes under "Add or change for impact", in their words, unsoftened, with the timescale intact. Severity changes the words, never the shape: this document still has all three sections, and Continue still appears if there is something true for it.',
  }[severity] || ''

  // The Continue section decides what opens the document, and it is conditional
  // on there being something true to say. That is the whole guard: a section
  // that can be left out cannot be padded.
  const openingRule = reframed && reframed.strength
    ? `The strength above is real and came out of the manager's own notes. It belongs under
Continue. Write the change as that same strength brought into balance.`
    : `There is no strength in these notes: a standard is being missed rather than a trait being
over-played. Unless the person's record gives you something genuine and specific, leave the
Continue heading out altogether and open at "Add or change for impact". Do not manufacture one.`

  const reframeBlock = reframed
    ? `
WHAT IS ACTUALLY BEING SAID, read out of the manager's rough notes:
Behaviour: ${reframed.behaviour}${reframed.strength ? `
The strength it is an over-play or under-play of: ${reframed.strength}` : ''}
${reframed.effect && !/^not stated\.?$/i.test(reframed.effect) ? `Effect: ${reframed.effect}
` : `The manager did not state an effect. There is no effect to write, and you must not deduce one.
`}Severity: ${severity}

${openingRule}

Use the behaviour and the effect as the specifics. Do not repeat the manager's own wording back
if it was a judgement about the person, and never use their insults, their sarcasm or their
temper. Nothing here is a new fact: it is what the manager wrote, read properly.

${SEVERITY_RULE}
`
    : ''

  const skillLabel = ['very low', 'low', 'medium', 'high', 'very high'][((skill || 3) - 1)]
  const confidenceLabel = ['very low', 'low', 'medium', 'high', 'very high'][((confidence || 3) - 1)]

  const registerBlock = `- Follows the three part structure below in every case, whatever the severity
- Says plainly what is not acceptable, and says it in the manager's own terms
- Is written in the selected register. Both carry the same message with the same force. What changes is the room each part gets. Follow the word counts. They are the instruction, not a guide.

  EMPATHETIC. 220 to 320 words. Give the evidence and the reason room. Name the effect on the people around them where the manager stated one. Take the person's own account seriously and say so.

  DIRECT. 130 to 200 words. Compress the strength and the evidence into one short paragraph. Keep sentences under twenty words. Cut every qualifier: no "I think", "perhaps", "it might be worth", "I would encourage you to".`

  const structureBlock = `STRUCTURE. Three sections, with these exact headings, each on its own line, in this order:

Continue
Add or change for impact
Actions

Under Continue: what the person should keep doing, specifically. This section only exists if
there is something true to put in it. If the manager's notes and the person's record give you
nothing genuine, leave the heading out entirely and open at "Add or change for impact". Never
write a strength to fill the space. This is the same rule as the absolute rule above, applied
to praise.

Under Add or change for impact: the change, the evidence for it, and why it matters, using the
manager's own facts and figures. Say plainly where something is not acceptable. Where the manager
has stated a consequence, a timescale or a formal process, it belongs here, in their words, with
nothing softened, nothing added, and no reassurance wrapped around it.

Under Actions: one short line of instruction, then three to five bullets, each on its own line
starting with an asterisk and a space. One practical thing per bullet, something the person can
start this week. Keep each under fifteen words.

Then close, after the bullets, with one or two sentences: an offer to talk it through, or a
request to book time and agree a plan together. Saying you believe the person can do this is
right and belongs here. Explaining that you do not mean to alarm them is not: that is throat
clearing about the document rather than confidence in the person.

Say what is true, in one statement. Do not define it against what it is not. "That is not a small
pattern, it is a regular one", "a requirement, not a target", "every day, not most days" are the
same construction three times over, and it is the clearest sign that a machine wrote the
document. One statement. No mirror.

Here is the format, written by the person whose product this is. Match the register, the bluntness
and the shape. Take none of the facts.

--- EXAMPLE, EMPATHETIC ---
Continue

I appreciate your dedication to your work and the effort you put in. You are a positive, energetic
team member.

Add or change for impact

You have been late 5 times in the last three months, which is unacceptable because you have missed
meetings, and clients and team members have noticed.

Actions

Please put this right immediately. And here are some suggestions to help.

* Set alarms or reminders to help you manage your time effectively.
* Plan your commute or tasks ahead to avoid any delays.
* Communicate proactively if you will be late due to unforeseen circumstances.
* Consider adjusting your morning routine to allow for unexpected delays.

I am always available if you would like to talk this through because I want you to succeed in your
role here and your career. And remember, consistent punctuality shows respect for your colleagues'
and clients' time and adds to a more efficient work environment. I believe you can make positive
changes in this area.

--- EXAMPLE, DIRECT ---
Continue

I appreciate your dedication to your work and the effort you put into everything you do.
Punctuality is a crucial part of a person's performance at work. Being late can disrupt other
people and affect team morale and productivity. You have been late 5 times this month.

Add or change for impact

Please make sure you arrive on time, with no exceptions, starting today.

Actions

* Aim to arrive at least 5 minutes early for meetings.
* Set reminders to leave home earlier in the morning to allow for unexpected delays.
* Communicate in advance if you are delayed, and make up for lost time by working extra where possible.

Book some time with me to discuss this feedback, and we can agree an action plan together.
--- END OF EXAMPLES ---`

  const systemPrompt = `You are an expert leadership coach helping managers deliver clear, constructive, and motivating feedback.

The leaders we remember are the ones who saw potential in us, challenged us to rise to it, and
supported us every step of the way. Write as one of those leaders would write.

ABSOLUTE RULE, and it outranks every other instruction here. Never invent a fact. Not a date, not
a number, not a name, not an incident, not an outcome, and above all not an action the manager
took. "I have had to step in personally to cover the gaps your timekeeping created" is exactly
the sentence that gets read back in a tribunal, and if the manager did not write it, it is false.
You are working from the manager's notes and the person's record, and from nothing else.

Where a specific would improve the writing and you do not have one, write the general truth or
leave the point out. A vague sentence is a small problem. An invented one is a serious problem,
because the person reading it knows it did not happen, and from that moment they disbelieve
everything else in the document.

You will generate TWO separate outputs. Separate them with exactly: ===GUIDE===

OUTPUT 1 — THE FEEDBACK
Generate feedback that:
- Is clear, direct, and human — sounds like a thoughtful manager, not a corporate document
- Is specific to the situation described — no generic praise or generic development points
${registerBlock}

Plain text. The only headings are the three named below, written as plain words on their own line, and the only bullets are the action bullets, written with an asterisk and a space. No markdown, no bold, no ## headings, no backticks, no hashtags. No exclamation marks. UK English. Do not use em dashes (—): use a comma, a colon, or a full stop instead. Do not use the words "leverage", "empower", "unlock", "journey", "delve", "robust", "seamless", "inspire", or the phrase "moving forward".

${structureBlock}

The feedback ends at its closing question. Nothing follows it: no summary, no next steps, and
above all no advice about how often to review progress. That advice belongs after the marker
below and the manager sees it in a separate panel. A warning that ends by recommending fortnightly
one-to-ones has run two documents together.

After the feedback, on a new line, write exactly: ===CADENCE===
Then write a cadence recommendation of two or three sentences: how often (weekly, fortnightly, monthly), in what format (informal conversation, structured one-to-one, written note), and why — based on the issue and the person's development stage.
Then list three cadence tags in square brackets on the next line — e.g. [Weekly] [Informal one-to-one] [Skills development]

Then write exactly: ===GUIDE===

OUTPUT 2 — THE CONVERSATION GUIDE
This is practical advice for the manager on how to have the conversation. It is NOT the feedback itself.

The person's skill level is: ${skillLabel}
The person's confidence level is: ${confidenceLabel}

Structure the guide using exactly these section markers — write each heading on its own line, followed immediately by the advice:

===SECTION===
Before the conversation
===SECTION===
Tone and approach
===SECTION===
How much direction to give
===SECTION===
What to listen for
===SECTION===
Suggested opening

CONTENT RULES for the guide:
- Always include this in "Before the conversation": Give the person advance notice of what you want to discuss. Do not ambush them with developmental feedback. It puts them on the defensive and closes down the conversation before it starts. A simple message the day before is enough: tell them you want to talk about their development and ask them to come ready to share their own view.
- Always include this in "Before the conversation" or "What to listen for": Ask for their view before you give yours. Good people are almost always harder on themselves than you would be. If you lead with your assessment, you lose the chance to hear theirs, and you lose the opportunity to let them arrive at the same conclusion themselves, which is far more powerful.
- Calibrate the rest of the advice based on skill and confidence level:
  - Low skill + low confidence: needs more structure, more encouragement, specific guidance on what good looks like, frequent check-ins
  - Low skill + high confidence: needs honest, direct feedback to recalibrate — be kind but clear, don't let confidence mask the skill gap
  - High skill + low confidence: needs reassurance, recognition of what they're already doing well, stretch challenges to rebuild belief
  - High skill + high confidence: can handle more autonomy, peer challenge, stretch goals — treat them as a partner in the conversation
- Write in plain prose, no bullet points, no jargon, no markdown, no asterisks, no bold, no exclamation marks
- UK English throughout, and do not use em dashes (—): use a comma, a colon, or a full stop instead. Do not use the words "leverage", "empower", "unlock", "journey", "delve", "robust", "seamless", "inspire", or the phrase "moving forward"
- Sound like a thoughtful senior colleague, not a training manual`

  // What the manager has already written down about this person, from their
  // record. Good developmental feedback opens on a genuine, specific strength,
  // and this is where the genuine, specific strength lives. Without it the
  // model has to invent one, and an invented strength is the fastest way to
  // make the praise sound like throat-clearing.
  const contextBlock = personContext && personContext.trim()
    ? `
WHAT THE MANAGER ALREADY KNOWS ABOUT THIS PERSON:
${personContext.trim()}

This is background about the person, not an agenda for this conversation. Use it
to make the writing specific and to know how this person takes things. Where the
manager's notes for this conversation name a behaviour, that is the development
point and this record does not add a second one.
Do not repeat these notes back verbatim. Do not mention that you were given them.
`
    : ''

  const userPrompt = `Feedback register: ${tone || 'Empathetic'}
Person's skill level: ${skillLabel}
Person's confidence level: ${confidenceLabel}
${contextBlock}${reframeBlock}
Manager's notes:
${inputText.trim()}

Write the feedback in the ${tone || 'Empathetic'} register, to the word count that register specifies.`

  try {
    const generated = await complete({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 16000,
      effort: 'low',
      temperature: 0.7
    })

    if (!generated.ok) {
      return res.status(generated.status).json({ error: generated.error })
    }

    // The model sometimes echoes the scaffold headings from the system prompt
    // ("OUTPUT 1 - THE FEEDBACK") into the document itself. Telling it not to
    // is a request. Removing them is a guarantee.
    const stripScaffold = (text) => {
      let out = String(text || '').trim()
      const heading = /^\s*(?:={3,}[A-Z]+={3,}|OUTPUT\s*\d+\b[^\n]*|THE FEEDBACK|THE CONVERSATION GUIDE)\s*(?:\n+|$)/i
      while (heading.test(out)) out = out.replace(heading, '').trim()
      return out
    }

    const full = generated.text

    const guideMarker = '===GUIDE==='
    const guideIndex = full.indexOf(guideMarker)

    let result = full
    let guide = ''

    if (guideIndex !== -1) {
      const head = full.slice(0, guideIndex).trim()
      const tail = full.slice(guideIndex + guideMarker.length).trim()
      // If the marker lands first, splitting on it leaves an empty feedback and
      // a blank screen. Keep whatever text there is over an empty pane.
      if (head) {
        result = head
        guide = tail
      } else {
        result = tail
      }
    }

    result = stripScaffold(result)
    guide = stripScaffold(guide)

    if (!full.includes('===CADENCE===')) {
      // Without the marker the cadence advice stays in the body of the
      // feedback, which is how a warning ends up recommending fortnightly
      // one-to-ones. Nothing to repair safely here, but it must not be silent.
      console.warn('[feedback] no CADENCE marker: cadence advice may be inside the feedback')
    }

    // ── The scrub ──────────────────────────────────────────────────────
    // On a formal warning the model keeps reaching for the praise sandwich,
    // because that is the shape it has seen most. Told plainly not to, with
    // the exact sentences quoted, it writes them anyway. So this stops asking.
    //
    // Three things learned the hard way, all of them from live output:
    //   1. The quick model is not good enough at this. It removed 237
    //      characters and left "I am not saying that to alarm you", which is
    //      quoted verbatim in its own instructions. The scrub runs on the
    //      writing model now. It is one extra call, on formal warnings only.
    //   2. A first pass misses things. So the output is checked mechanically,
    //      and anything that survives is quoted back for one more pass.
    //   3. The guard rejected a clean scrub at ratio 0.34 with nothing
    //      missing. Length was never the thing that mattered.
    if (isFormal && result) {
      const UNIT = 'month|months|week|weeks|day|days|time|times|occasion|occasions|hour|hours|minute|minutes'
      const NUMBER_WORD = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve'

      // The record: what the person and anyone reading it later must still find.
      const loadBearing = (t) => {
        const digits = t.match(/\b\d+\b/g) || []
        const counted = t.match(new RegExp(`\\b(?:${NUMBER_WORD})\\s+(?:${UNIT})\\b`, 'gi')) || []
        const process = t.match(/\b(?:disciplinary|dismissal|gross misconduct|written warning|final warning|probation|capability procedure)\b/gi) || []
        return [...new Set([...digits, ...counted, ...process].map((x) => x.toLowerCase().replace(/\s+/g, ' ')))]
      }

      // What must not be there. Regex cannot judge invented praise, but it can
      // catch these exactly, which is why they are worth catching this way.
      const BANNED = [
        { name: 'reassurance', re: /\bnot\s+(?:saying|raising|telling)\b[^.?!]{0,80}?\bto\s+(?:alarm|frighten|worry|scare|panic)\b/i },
        { name: 'reassurance', re: /\bdo\s+not\s+want\s+(?:that|this)\s+for\s+you\b/i },
        // Deliberately absent: "I believe you can". That is confidence in the
        // person, it is in Jim's own examples, and it stays.
        { name: 'reassurance', re: /\bthis\s+is\s+not\s+who\s+you\s+(?:are|really\s+are)\b/i },
        { name: 'hinge', re: /(?:^|[.!?]\s+|\n\s*)(?:But|However|That said|Although|Yet)\b/ },
        { name: 'hinge', re: /,\s+(?:but|however|although|yet)\s/i },
        { name: 'speculation', re: /\b(?:childcare|child\s?care|caring\s+responsibilit|health\s+(?:issue|problem)|personal\s+(?:issue|problem)|family\s+(?:issue|problem))\b/i },
        // "not a small pattern, it is a regular one" / "a requirement, not a
        // target" / "every day, not most days". The single most recognisable
        // tell that a machine wrote the sentence, and Jim bans it outright.
        { name: 'antithesis', re: /\bnot\s+[^.,;:!?]{2,45},\s*(?:it['’]s|it is|they are|but)\b/i },
        { name: 'antithesis', re: /,\s*not\s+[a-z][^.,;:!?]{2,45}[.?!]/i },
        { name: 'antithesis', re: /\bnot\s+(?:a|as|an)\s+[^.,;:!?]{2,45}\s+but\s+(?:a|as|an)\b/i },
      ]
      const offencesIn = (t) => BANNED.filter((b) => b.re.test(t)).map((b) => b.name)

      const RULES = `Delete every sentence, or part of a sentence, that does any of the following, then repair the
joins so the prose still reads properly:
- defends the document rather than addressing the person: "I am not saying this to alarm you",
  "I am not raising that to alarm you", "I am not saying that to frighten you", "I do not want
  that for you", "this is not who you are". A manager who has to explain that a warning is not
  meant to alarm has written a warning they are not sure they meant. Note the difference between
  that and "I believe you can make positive changes in this area", which is confidence in the
  person and stays.
- hinges with but, however, that said, although or yet, whether it starts a sentence or sits
  inside one after a comma
- defines something by what it is not: "that is not a small pattern, it is a regular one", "a
  requirement, not a target", "every day, not most days". Cut the negative half and keep the
  positive statement on its own. "That is a pattern." "That is a requirement." "Every day."
  This construction is the clearest sign a machine wrote the document and it must not survive.
- guesses at why the person is behaving this way. "whether that is a schedule issue, a childcare
  issue, or something else entirely" goes. Speculating about someone's home life in a
  disciplinary document is both invented and the kind of guess that causes a second problem.
- states a fact the manager's notes do not contain: a date, a number, a name, an incident, or
  anything the manager is said to have done about it. "I have had to step in personally to cover
  the gaps" goes unless the notes say so. This one matters most. Praise that is not true is
  embarrassing; an invented account of events is the sentence that loses a tribunal.

Work at clause level where a sentence is only half wrong: "I am not raising that to alarm you, I
am raising it because I want you to know what is at stake" becomes "I am raising it because I
want you to know what is at stake."

You may only delete, and mend what sits either side of a deletion. Do not add a fact, a sentence,
a softening, or a heading. Do not reword anything you are keeping. Every number, date, timescale,
standard and consequence must survive exactly as written.

Return only the corrected warning, nothing else.`

      const runScrub = async (draft, quoted) => {
        const prompt = `Below is a formal written warning drafted for a manager, followed by the
manager's own notes. The warning must not contain anything the notes do not support.

${RULES}${quoted ? `

A previous pass left these in. Remove them: ${quoted}` : ''}

--- THE WARNING ---
${draft}

--- THE MANAGER'S NOTES ---
${inputText.trim()}`

        // Not the quick model. It is not good enough at this.
        const r = await complete({ messages: [{ role: 'user', content: prompt }], maxTokens: 8000 })
        return r.ok ? stripScaffold(r.text) : ''
      }

      const original = result
      const needed = loadBearing(original)
      // Length is not the guard. A warning under 400 characters has lost its
      // substance whatever the ratio says, and that is all the floor is for.
      const passes = (candidate) => {
        const hay = candidate.toLowerCase().replace(/\s+/g, ' ')
        const missing = needed.filter((tok) => !hay.includes(tok))
        return { ok: candidate.length >= 400 && missing.length === 0, missing }
      }

      let cleaned = await runScrub(original, '')
      let verdict = cleaned ? passes(cleaned) : { ok: false, missing: [] }

      if (verdict.ok) {
        const left = offencesIn(cleaned)
        if (left.length) {
          console.warn('[feedback] scrub pass 1 left:', left.join(', '), '- running pass 2')
          const second = await runScrub(cleaned, left.join(', '))
          const secondVerdict = second ? passes(second) : { ok: false, missing: [] }
          if (secondVerdict.ok) {
            cleaned = second
            verdict = secondVerdict
          } else {
            console.warn('[feedback] scrub pass 2 rejected, keeping pass 1. missing:', secondVerdict.missing.join(' | ') || 'none')
          }
        }
        console.log('[feedback] scrub applied,', original.length - cleaned.length, 'chars removed. remaining:', offencesIn(cleaned).join(', ') || 'none')
        result = cleaned
      } else if (cleaned) {
        console.warn('[feedback] scrub rejected. length', cleaned.length, 'missing:', verdict.missing.join(' | ') || 'none')
      } else {
        console.warn('[feedback] scrub returned nothing, keeping the original')
      }
    }

    return res.status(200).json({ result, guide })

  } catch (err) {
    console.error('Handler error:', err)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
}
