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
    FORMAL: 'Reframing changes how this reads, never how serious it is or how it is structured. The words the manager chose for the consequence, the process and the timescale are the record. Carry every one of them through unchanged.',
  }[severity] || ''

  // Who the document opens on. A formal warning that opens on a strength
  // reads as ambivalent, and a person who reads it hears the praise and
  // misses the warning. It is also the weaker document if it is ever read
  // back in a dispute.
  const openingRule = isFormal
    ? `This is a formal warning. It does not open on a strength, and it does not close on one.
The strength above, if there is one, is context for you and not a paragraph for the person.`
    : reframed && reframed.strength
      ? `Open on the strength above, stated as fact. Write the development as that same strength
brought into balance, never as a flaw to fix.`
      : `There is no strength in these notes to open on, because a standard is being missed rather
than a trait over-played. Do not manufacture one. Open on what is happening. If the manager's own
notes or the person's record name something they do well, you may use that and nothing else.`

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

  const registerBlock = isFormal
    ? `- Opens on the standard and what has happened against it
- Records, requires, and offers one route to support
- Is written in the selected register. Both carry the same warning with the same force. What changes is the length and how much room each point gets. Follow the word counts. They are the instruction, not a guide.

  EMPATHETIC. 250 to 350 words. Give the facts and the effect room. Take the person's own account seriously and say so. The warmth is in the attention.

  DIRECT. 150 to 220 words. Four or five paragraphs. Keep sentences under twenty words. Cut every qualifier: no "I think", "perhaps", "it might be worth", "I would encourage you to".`
    : `- Leads from a genuine strength and frames the development as the next step up from that strength, never as a flaw to fix
- Reinforces the person's belief in their own ability by granting them earned trust and scope, not by reassuring them
- Is written in the selected register. The two registers produce genuinely different documents, not the same document with different adjectives. Follow the word counts. They are the instruction, not a guide.

  EMPATHETIC. 350 to 450 words. Give each of the five points below room: two or three sentences each. Name the effect their work has on the people around them, and describe what the shift will feel like from the inside. Vary your sentence length. Use their first name once, early. The warmth is in how much attention you give them, not in softening the language.

  DIRECT. 180 to 250 words. One sentence per point, two at the most. Say the development once, in a single clean sentence, and do not circle back to it. Describe standards and outcomes rather than feelings. Keep sentences under twenty words. Cut every qualifier: no "I think", "perhaps", "it might be worth", "one thing to consider", "I would encourage you to". The respect is in not wasting their time.

  Both registers follow the same five point structure below and the same cardinal rule. What changes is the length, the elaboration and the amount of qualification. Someone handed both versions should tell them apart at a glance, before reading a word.`

  const structureBlock = isFormal
    ? `STRUCTURE. A formal warning is a record as much as a conversation. Someone may read it a year from
now with no memory of the meeting, so everything it needs must be on the page.

It covers, in this order: the standard, what has happened against it, what must change, the
consequence and the timescale the manager gave, an offer of help, and a question inviting the
person's account. Where the manager stated an effect, it goes with the facts. Where they did not,
there is no effect and you must not deduce one.

Do not number the paragraphs and do not write one paragraph per item. Two items often belong
together in one paragraph. Vary the length of your sentences and your paragraphs.

Say what is true, in one statement. Do not define it against what it is not. "That is not a small
pattern, it is a regular one", "a requirement, not a target", "every day, not most days", "this
starts now, not when things settle down" are the same construction four times over, and it is the
clearest possible sign that a machine wrote the document. One statement. No mirror.

There is no praise anywhere in a formal warning, at the opening, the close, or folded into the
middle, and nothing that tells the person how to feel about it. Both make the warning look like
the manager was unsure they meant it.

Here is the shape. The facts are not yours: the rhythm is.

--- EXAMPLE, DIRECT ---
Mark, the weekly report is due by five o'clock on Friday. That is the standard for everyone on the
team and it has not changed.

Over the last two months you have submitted it late six times. Three of those were more than a day
late. Monday's planning meeting is built on those figures, and twice it has started without them.

I need the report in by five o'clock every Friday, starting this week.

If it is late again in the next two months, we will move to a formal disciplinary process.

If something about the Friday deadline does not work, tell me and I will look at it. What is making
it hard to hit?

--- EXAMPLE, EMPATHETIC ---
Mark, I want to talk about the weekly report and be straight with you about where it has got to.

The deadline is five o'clock on Friday. It is the same for everyone, and it exists because Monday's
planning meeting is built on those figures.

Over the last two months the report has come in late six times. Three of those were more than a day
late. Twice the Monday meeting has started without your numbers, and the people in the room have had
to plan around the gap. That is the part I keep coming back to, because it lands on other people
rather than on you.

What I need from here is the report submitted by five o'clock every Friday, starting this week, as a
fixed commitment rather than something we revisit.

I have to be clear about what follows if that does not happen. If the report is late again within the
next two months, we will move to a formal disciplinary process. That is the position, and you should
have it in full.

I also want your side of it. If there is something about the Friday deadline that does not work, or
something further up the chain holding you up, I want to know, because that is the kind of thing I can
do something about.

What is getting in the way of Friday?
--- END OF EXAMPLES ---

Match the rhythm and the plainness of whichever example matches the selected register. Take nothing
else from them: not the job, not the deadline, not the numbers, not the name.`
    : `Observe the cardinal rule: never hinge from something good to something that must change with "however", "but", "that said", "although", "yet", or any equivalent. This applies inside a single sentence as much as between sections. "You speak with confidence, but you do not invite input" is exactly the fault: it tells the listener the first half was throat-clearing. Put a full stop in and start the next sentence with the behaviour itself. The strength is the platform the development sits on, not a setup for criticism. Follow these points in order:
1. Open on a genuine, specific strength. State it plainly as fact, not as a compliment being banked.
2. Build on that strength: name the specific behaviours that are landing well and the value they create.
3. The shift: exactly ONE development, never two. If the notes and the record both suggest something, take the one the manager has written about this time and leave the other alone. Describe that single development as the next step up that adds to what they already do well. Frame it as increased scope, trust, or authority they are ready for. Where you can, describe the specific behaviour that closes the gap, phrased as something they do, not something they lack.
4. What this opens up for them: the opportunity the shift earns, how they will feel, and how they will be seen. Keep it specific to this person.
5. Close by granting something real: state plainly the trust, autonomy, or recognition they have earned. In the same breath ask for their view and what they want to do about it, so the next step is agreed between the two of you rather than handed down. If you end on a question, punctuate it as one. End on what they have earned, not on a scheduled meeting and not on piled-on reassurance. The motivation comes from what you grant, not from encouragement. Do not use a rallying-cry line ("you've got this", "this is your chance to shine").`

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

STRUCTURE for the feedback. Plain prose only: no markdown, no asterisks, no bold, no ## headings, no bullet points, no backticks, no hashtags. No exclamation marks. UK English. Do not use em dashes (—): use a comma, a colon, or a full stop instead. Do not use the words "leverage", "empower", "unlock", "journey", "delve", "robust", "seamless", "inspire", or the phrase "moving forward".

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
- praises the person or credits them with a quality, however briefly ("I know you bring real
  drive", "I don't think this is about a lack of care", "you clearly care about the work")
- tells the person how to feel about the warning. Every version of this goes, whatever the verb:
  "I am not saying this to alarm you", "I am not raising that to alarm you", "I am not saying
  that to frighten you", "I do not want that for you", "this is not who you are", "I believe you
  will turn this around". A manager who has to explain that a warning is not meant to alarm has
  written a warning they are not sure they meant.
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
