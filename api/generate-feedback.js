import { complete } from '../lib/llm.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { inputText, tone, skill, confidence, personContext, mode, managerName, recipientName } = req.body || {}

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
incident, not an outcome. You are re-describing what the manager already wrote. An invented
detail is worse than a vague note, because the person will know it is wrong and will stop
believing the rest of the conversation.

Two more rules that matter as much.

Turn character into behaviour. A verdict about who someone is ("arrogant", "lazy", "difficult")
becomes a description of what they do and the effect it has. Keep the substance. "Arrogant"
becomes confidence that lands as arrogance, which is the same message in words a person can act
on.

Find the strength the behaviour is an over-play or under-play of, if there is one. Confidence
overplayed reads as arrogance. Care for detail overplayed reads as slowness. Modesty overplayed
reads as failing to step up. Pace overplayed reads as carelessness.

Often there is no strength there at all. A person who is repeatedly late, absent, or missing
deadlines is missing a standard. Naming "drive" or "commitment" in that gap would be an invented
fact wearing a compliment's clothes, and the ABSOLUTE RULE covers it. When you cannot name a
strength out of the manager's own material, write none. Never reach for one.

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
    CORRECTIVE: 'A standard is being missed. Name the standard plainly and be unambiguous that it has to change. Warm language. A firm message.',
    FORMAL: 'The manager has stated a consequence, a deadline or a formal process. It goes in the second beat, in their words, unsoftened, with the timescale intact. Severity changes the words. The shape stays the same.',
  }[severity] || ''

  // The reframe is a second reader of the same notes. Its lines help the
  // writer see the behaviour under the heat. They are never a source of new
  // facts, and the notes outrank them wherever the two differ.
  const reframeBlock = reframed
    ? `
WHAT IS ACTUALLY BEING SAID, read out of the manager's rough notes:
Behaviour: ${reframed.behaviour}${reframed.strength ? `
The strength it is an over-play or under-play of: ${reframed.strength}` : ''}
${reframed.effect && !/^not stated\.?$/i.test(reframed.effect) ? `Effect: ${reframed.effect}
` : `The manager did not state an effect. There is no effect to write, and you must not deduce one.
`}Severity: ${severity}

${reframed.strength
  ? `The strength above came out of the manager's own notes. It is context for the first beat: one sentence, where it is true. Write the change as that same strength brought into balance.`
  : `No strength was found in these notes. Do not supply one. The first beat is the facts alone.`}

Use the behaviour and the effect as the specifics. Do not repeat the manager's own wording back
if it was a judgement about the person, and never use their insults, their sarcasm or their
temper. Where these lines and the manager's notes differ, the notes win.

${SEVERITY_RULE}
`
    : ''

  const skillLabel = ['very low', 'low', 'medium', 'high', 'very high'][((skill || 3) - 1)]
  const confidenceLabel = ['very low', 'low', 'medium', 'high', 'very high'][((confidence || 3) - 1)]

  const registerBlock = `- Says plainly what is not acceptable, and says it in the manager's own terms
- Is written in the selected register. Both carry the same message with the same force. What changes is the room each part gets. Follow the word counts. They are the instruction.

  EMPATHETIC. 120 to 200 words. Give the evidence and the reason room. Name the effect on the people around them where the manager stated one. Where the manager's notes record what the person said or intended, acknowledge it. Where they do not, do not guess.

  DIRECT. 70 to 130 words. Fact first. Keep sentences under twenty words. Cut every qualifier: no "I think", "perhaps", "it might be worth", "I would encourage you to", "feel free to".`

  const structureBlock = `STRUCTURE. The feedback is a short letter in three beats. The beats are for you. They are never
written down: no headings, no labels, no numbering. The reader sees paragraphs, a list if there
is one, and a sign-off.

BEAT ONE, THE CONTEXT. What happened, in the manager's facts. Where the notes or the person's
record hold a real strength, it sits here as context, in one sentence. Where they hold none, the
first beat is the facts alone. Never write a strength to fill the space. This is the absolute
rule above, applied to praise. "I know you care about doing good work", "I know your drive is
real" and anything like them are facts about a real person that nobody has established.

BEAT TWO, THE GAP TO BE CLOSED. The change, the evidence for it, and why it matters, using the
manager's own facts and figures. Say plainly where something is not acceptable. Where the manager
has stated a consequence, a timescale or a formal process, it belongs here, in their words, with
nothing softened, nothing added, and no reassurance wrapped around it.

Where the manager's notes show that the manager made the final decision, or went along with the
person's recommendation, say so in one plain sentence in the manager's voice and own it: "I made the
call, and that is mine to carry." Then say what is needed from the person. A document that puts the
whole weight on the person for a decision the manager made reads as unfair, and from that line on
nothing else in it lands.

Where the notes describe something still exposed today, a person, a client or a piece of work,
say what happens about that now, with a time.

BEAT THREE, THE CALL TO ACTION. It opens with an offer of a conversation or coaching, and it asks
the person to think about what they can do to put things right for themselves. The sentence that
does this is: "Come to that meeting with your view of what will put this right." Use it, or
something as short. Suggestions to help are optional: where the manager has some, two to four
bullets, each on its own line starting with an asterisk and a space, one practical thing each,
under fifteen words, each a different action. Where there is something still exposed today, the
first suggestion is about that. Then, if it is true, one sentence of confidence in the person: "I
believe you can make positive changes in this area" claims nothing about them that has to be true.
"I know you have the drive to turn this round" does, and unless the manager wrote that the person
has drive, it is an invented fact hiding in an encouragement. Do not tell the person how they feel
or how this will sit with them. "I know this will weigh on you" is a fact about them that nobody
established. Do not explain that you do not mean to alarm them: that is throat clearing about the
document.

Say what is true, in one statement. Do not define it against what it is not. "That is not a small
pattern, it is a regular one", "a requirement, not a target", "every day, not most days" are the
same construction three times over, and it is the clearest sign that a machine wrote the
document. One statement. No mirror. "This is not about whether your instinct was reasonable. It is
that..." is the same construction with a full stop in the middle. Start at "It is that" and say it.

Here is the format, written by the person whose product this is. The beat labels in square brackets
are annotations for you. Never write them. Match the register, the bluntness and the shape. Take
none of the facts.

--- EXAMPLE, EMPATHETIC ---
Sam,

[beat one: the context]
I appreciate your dedication to your work and the effort you put in. You are a positive, energetic
team member.

[beat two: the gap to be closed]
You have been late 5 times in the last three months, which is unacceptable because you have missed
meetings, and clients and team members have noticed.

[beat three: the call to action]
I am always available if you would like to talk this through, because I want you to succeed in your
role here and your career. Please put this right immediately. Come to that meeting with your view
of what will put this right. I believe you can make positive changes in this area and will support
you where I can.

Jim

--- EXAMPLE, DIRECT ---
Sam,

[beat one: the context]
You have been late 5 times this month. I appreciate your dedication to your work and the effort you
put into everything you do. Punctuality is a crucial part of a person's performance at work. It
affects how they are seen, and being late can disrupt customers, colleagues and team morale.

[beat two: the gap to be closed]
Please make sure you arrive on time, with no exceptions, starting today.

[beat three: the call to action]
Book some time with me to discuss this feedback, and we can agree an action plan together. Come to
that meeting with your view of what will put this right. Some suggestions to help:

* Aim to arrive at least 5 minutes early for meetings.
* Set reminders to leave home earlier in the morning to allow for unexpected delays.
* Communicate in advance if you are delayed, and make up for lost time where possible.

Jim
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
- Is clear, direct, and human. It sounds like a thoughtful manager.
- Is specific to the situation described. No generic praise and no generic development points.
${registerBlock}

Plain text. No headings of any kind. The only bullets are the suggestion bullets, written with an asterisk and a space. No markdown, no bold, no ## headings, no backticks, no hashtags. No exclamation marks. UK English. Do not use em dashes (—): use a comma, a colon, or a full stop instead. Do not use the words "leverage", "empower", "unlock", "journey", "delve", "robust", "seamless", "inspire", "genuinely", or the phrase "moving forward".

${structureBlock}

The feedback ends at the sign-off. Nothing follows it: no summary, no next steps, and above all no
advice about how often to review progress. That advice belongs after the marker below and the
manager sees it in a separate panel. A document that ends by recommending fortnightly one-to-ones
has run two documents together.

After the feedback, on a new line, write exactly: ===CADENCE===
Then write a cadence recommendation of two or three sentences: how often (weekly, fortnightly, monthly), in what format (informal conversation, structured one-to-one, written note), and why, based on the issue and the person's development stage.
Then list three cadence tags in square brackets on the next line, for example [Weekly] [Informal one-to-one] [Skills development]

Then write exactly: ===GUIDE===

OUTPUT 2 — THE CONVERSATION GUIDE
This is practical advice to the manager on how to have the conversation.

The person's skill level is: ${skillLabel}
The person's confidence level is: ${confidenceLabel}

Structure the guide using exactly these section markers. Write each heading on its own line, followed immediately by the advice:

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
- Always include this in "Before the conversation": Give the person advance notice of what you want to discuss. Do not ambush them with challenging or developmental feedback. It puts them on the defensive and closes down the conversation before it starts. A simple message the day before is enough: tell them you want to talk about their development and ask them to come ready to share their own view.
- Always include this in "Before the conversation" or "What to listen for": Ask for their view before you give yours. Good people are almost always harder on themselves than you would be. If you lead with your assessment, you lose the chance to hear theirs, and you lose the opportunity to let them arrive at the same conclusion themselves, which is far more powerful.
- Calibrate the rest of the advice based on skill and confidence level:
  - Low skill + low confidence: needs more structure, more encouragement, specific guidance on what good looks like, frequent check-ins
  - Low skill + high confidence: needs honest, direct feedback to recalibrate. Be kind and clear. Confidence can mask the skill gap.
  - High skill + low confidence: needs reassurance, recognition of what they are already doing well, stretch challenges to rebuild belief
  - High skill + high confidence: can handle more autonomy, peer challenge, stretch goals. Treat them as a partner in the conversation.
- Where the manager's notes record what the person said or intended, use it. Where they do not, do not guess at the person's motives or feelings.
- Write in plain prose, no bullet points, no jargon, no markdown, no asterisks, no bold, no exclamation marks
- UK English throughout, and do not use em dashes (—): use a comma, a colon, or a full stop instead. Do not use the words "leverage", "empower", "unlock", "journey", "delve", "robust", "seamless", "inspire", "genuinely", or the phrase "moving forward"
- Say what is true in one statement. Do not define it against what it is not. "Direct, not padded" and "a proper conversation, not a corridor chat" are both banned. Write "direct." Write "a proper sit-down conversation."
- Sound like a thoughtful senior colleague`

  // What the manager has already written down about this person, from their
  // record. Good developmental feedback opens on a genuine, specific strength,
  // and this is where the genuine, specific strength lives. Without it the
  // model has to invent one, and an invented strength is the fastest way to
  // make the praise sound like throat-clearing.
  const contextBlock = personContext && personContext.trim()
    ? `
WHAT THE MANAGER ALREADY KNOWS ABOUT THIS PERSON:
${personContext.trim()}

This is background about the person. Use it to make the writing specific and to
know how this person takes things. The manager's notes for this conversation name
the development point, and this record does not add a second one.
Do not repeat these notes back verbatim. Do not mention that you were given them.
`
    : ''

  // When the reframe found no strength and the record is empty, the first
  // beat is the facts alone. Said flatly, in the user turn, where the model
  // is actually looking, because a conditional rule buried in the system
  // prompt lost this argument four times running.
  const noStrength = !(reframed && reframed.strength) && !(personContext && personContext.trim())
  const noStrengthDirective = noStrength
    ? `
THERE IS NO STRENGTH TO WRITE. The manager has written nothing good about this person and the
record holds nothing either. Open on the facts. Do not write a sentence of praise anywhere.
`
    : ''

  // The two names. Real, given by the manager, so they may be used. They are
  // the only facts about either person that arrive from outside the notes.
  const manager = (managerName || '').trim()
  const recipient = (recipientName || '').trim()
  const recipientFirst = recipient.split(/\s+/)[0] || ''
  const managerFirst = manager.split(/\s+/)[0] || ''
  const namesBlock = (manager || recipient)
    ? `${manager ? `Manager writing this: ${manager}\n` : ''}${recipient ? `Person it is for: ${recipient}\n` : ''}`
    : ''
  const namesDirective = (recipientFirst || managerFirst)
    ? `
${recipientFirst ? `The first line of the document is "${recipientFirst}," on its own. Use the name "${recipientFirst}" where a name reads naturally, no more than twice in the body. ` : ''}${managerFirst ? `The last line of the feedback, before the ===CADENCE=== line, is "${managerFirst}" on its own. ` : ''}Do not invent a surname, a title or a role for either person.
`
    : ''

  const userPrompt = `Feedback register: ${tone || 'Empathetic'}
${namesBlock}Person's skill level: ${skillLabel}
Person's confidence level: ${confidenceLabel}
${contextBlock}${reframeBlock}${noStrengthDirective}
Manager's notes:
${inputText.trim()}
${namesDirective}
Write the feedback in the ${tone || 'Empathetic'} register, to the word count that register specifies.
No headings and no beat labels: paragraphs, a list if there is one, a sign-off.
Every fact in it must be in the manager's notes above. If you are about to explain why something
happened and the notes do not say why, leave the why out.`

  try {
    // No temperature: current models reject it, and the adapter has been
    // quietly dropping it. Effort and headroom are the settings that matter.
    const generated = await complete({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 16000,
      effort: 'low',
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

    // The old section headings and the beat labels are scaffolding. If any
    // of them reach the page, the reader sees the machinery. Removed here,
    // and logged, because the prompt has asked for their absence and the
    // prompt is a request.
    const stripLabels = (t) =>
      String(t || '').replace(/^[ \t]*(?:\[?beat\s*(?:one|two|three|\d)\b[^\n]*\]?|Continue|Add or change for impact|Actions)[ \t]*\n+/gim, '')
    const beforeLabels = result.length
    result = stripLabels(result)
    if (result.length !== beforeLabels) console.warn('[feedback] scaffold label reached the document and was removed')

    const paragraphs = result.split(/\n\s*\n/).filter((p) => p.trim()).length
    if (paragraphs < 3) console.warn('[feedback] document has', paragraphs, 'paragraphs; expected at least three')

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
    if (result) {
      const UNIT = 'month|months|week|weeks|day|days|time|times|occasion|occasions|hour|hours|minute|minutes'
      const NUMBER_WORD = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve'

      // The record: what the person and anyone reading it later must still find.
      const loadBearing = (t) => {
        const digits = t.match(/\b\d+\b/g) || []
        const counted = t.match(new RegExp(`\\b(?:${NUMBER_WORD})\\s+(?:${UNIT})\\b`, 'gi')) || []
        const process = t.match(/\b(?:disciplinary|dismissal|gross misconduct|written warning|final warning|probation|capability procedure)\b/gi) || []
        // The guide's section headings are part of its record: a scrub that
        // eats one returns a guide the renderer cannot lay out.
        const sections = t.match(/^(?:Before the conversation|Tone and approach|How much direction to give|What to listen for|Suggested opening)$/gim) || []
        return [...new Set([...digits, ...counted, ...process, ...sections].map((x) => x.toLowerCase().replace(/\s+/g, ' ')))]
      }

      // What must not be there. Regex cannot judge invented praise, but it can
      // catch these exactly, which is why they are worth catching this way.
      const BANNED = [
        { name: 'reassurance', re: /\bnot\s+(?:say|saying|raise|raising|tell|telling|mention|mentioning|share|sharing)\b[^.?!]{0,80}?\bto\s+(?:alarm|frighten|worry|scare|panic|upset)\b/i },
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
        // "This is not about X. It is that Y." Same mirror, full stop in the middle.
        { name: 'antithesis', re: /\b(?:this|that|it)\s+is\s+not\s+about\b/i },
      ]
      const offencesIn = (t) => BANNED.filter((b) => b.re.test(t)).map((b) => b.name)

      const RULES = `Delete every sentence, or part of a sentence, that does any of the following, then repair the
joins so the prose still reads properly:
- defends the document instead of addressing the person, in any tense: "I am not saying this to
  alarm you", "I am not raising that to alarm you", "I do not say that to frighten you", "I do not
  want that for you", "this is not who you are". A manager who has to explain that a warning is not
  meant to alarm has written a warning they are not sure they meant. "I believe you can make
  positive changes in this area" is different: that is confidence in the person, and it stays.
- hinges with but, however, that said, although or yet, whether it starts a sentence or sits
  inside one after a comma
- defines something by what it is not: "that is not a small pattern, it is a regular one", "a
  requirement, not a target", "every day, not most days". Cut the negative half and keep the
  positive statement on its own. "That is a pattern." "That is a requirement." "Every day."
  This construction is the clearest sign a machine wrote the document and it must not survive.
- guesses at why the person is behaving this way, or how they feel. "whether that is a schedule
  issue, a childcare issue, or something else entirely" goes. "feeling he was trying to help"
  goes. Speculating about someone's motives or home life is invented, and it is the kind of guess
  that causes a second problem.
- states a fact the manager's notes do not contain: a date, a number, a name, an incident, a reason
  why something happened, or anything the manager is said to have done about it. "I have had to
  step in personally to cover the gaps" goes unless the notes say so. This one matters most. Praise
  that is not true is embarrassing; an invented account of events is the sentence that loses a
  tribunal.

Work at clause level where a sentence is only half wrong: "I am not raising that to alarm you, I
am raising it because I want you to know what is at stake" becomes "I am raising it because I
want you to know what is at stake."

Structure stays. A salutation line, a sign-off line, a line starting with an asterisk, and any
heading line on its own are all left exactly where they are. Never delete one, never add one,
never merge two paragraphs into one.

Never leave a stump. If removing a sentence orphans the one after it, so that it opens with "It is",
"This is", "That is" or "They are" and now refers to nothing, delete that sentence too. "I know your
drive is real. It is about a basic standard that has not been met." is a scar, and it reads worse
than the sentence you removed.

You may only delete, and mend what sits either side of a deletion. Do not add a fact, a sentence, or
a softening. Do not reword anything you are keeping. Every number, date, timescale, standard and
consequence must survive exactly as written.

Return only the corrected document, nothing else.`

      const runScrub = async (draft, quoted) => {
        const prompt = `Below is a document drafted for a manager, followed by the manager's own
notes. The document must not contain anything the notes do not support.

${RULES}${quoted ? `

A previous pass left these in. Remove them: ${quoted}` : ''}

--- THE DOCUMENT ---
${draft}

--- THE MANAGER'S NOTES ---
${inputText.trim()}`

        // Not the quick model: it is not good enough at this. Moving to the
        // writing model without an effort setting cost us a live run, because
        // max_tokens counts thinking tokens and Sonnet spent all 8000 of them
        // thinking and returned nothing. Deletion needs no deliberation.
        const r = await complete({
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 16000,
          effort: 'low',
        })
        return r.ok ? stripScaffold(r.text) : ''
      }

      // One scrub, applied to either output. The feedback is always scrubbed
      // on a formal warning. Otherwise, and for the guide every time, the
      // mechanical check runs first and the scrub only when it finds
      // something, so an ordinary run pays for the check and nothing more.
      // Until 19 September the scrub ran on formal feedback only, and a
      // developmental document went out with four antitheses in it.
      const scrubIfNeeded = async (text, label, always) => {
        if (!text) return text
        const pre = offencesIn(text)
        if (!always && !pre.length) {
          console.log(`[feedback] ${label} scrub check: clean`)
          return text
        }
        console.log(`[feedback] ${label} scrub check:`, pre.length ? pre.join(', ') : 'clean (formal, scrubbing anyway)')

        const needed = loadBearing(text)
        // Length is a floor, never the guard. A document under 300 characters
        // has lost its substance whatever the ratio says.
        const passes = (candidate) => {
          const hay = candidate.toLowerCase().replace(/\s+/g, ' ')
          const missing = needed.filter((tok) => !hay.includes(tok))
          return { ok: candidate.length >= 300 && missing.length === 0, missing }
        }

        let cleaned = await runScrub(text, '')
        let verdict = cleaned ? passes(cleaned) : { ok: false, missing: [] }

        if (!verdict.ok) {
          if (cleaned) console.warn(`[feedback] ${label} scrub rejected. length`, cleaned.length, 'missing:', verdict.missing.join(' | ') || 'none')
          else console.warn(`[feedback] ${label} scrub returned nothing, keeping the original`)
          return text
        }

        const left = offencesIn(cleaned)
        if (left.length) {
          console.warn(`[feedback] ${label} scrub pass 1 left:`, left.join(', '), '- running pass 2')
          const second = await runScrub(cleaned, left.join(', '))
          const secondVerdict = second ? passes(second) : { ok: false, missing: [] }
          if (secondVerdict.ok) cleaned = second
          else console.warn(`[feedback] ${label} scrub pass 2 rejected, keeping pass 1. missing:`, secondVerdict.missing.join(' | ') || 'none')
        }
        console.log(`[feedback] ${label} scrub applied,`, text.length - cleaned.length, 'chars removed. remaining:', offencesIn(cleaned).join(', ') || 'none')
        return cleaned
      }

      result = await scrubIfNeeded(result, 'feedback', isFormal)
      guide = await scrubIfNeeded(guide, 'guide', false)
    }

    // Enforced, not instructed. On 19 September the scrub ran twice on a
    // developmental document and still left ", not just in passing". The tail
    // cut removes only the comma-led negative half of a sentence, ", not just
    // in passing." / ", not a lecture.", which is Jim's own rule: keep the
    // positive statement, drop the mirror. It is blind: ", not with HR." goes
    // too. Known, and accepted.
    const cutNotTail = (t) =>
      String(t || '').replace(/,\s*not\s+(?:just\s+|only\s+|merely\s+)?[a-z][^.,;:!?\n]{1,45}(?=[.?!])/gi, '')

    const beforeFix = result.length + guide.length
    result = cutNotTail(result)
    guide = cutNotTail(guide)
    const removed = beforeFix - (result.length + guide.length)
    if (removed > 0) console.log('[feedback] mechanical fix removed', removed, 'chars')

    return res.status(200).json({ result, guide })

  } catch (err) {
    console.error('Handler error:', err)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
}
