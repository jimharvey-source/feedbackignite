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

Find the strength the behaviour is an over-play or under-play of. Confidence overplayed reads as
arrogance. Care for detail overplayed reads as slowness. Modesty overplayed reads as failing to
step up. Pace overplayed reads as carelessness. The strength must be genuinely present in what
the manager described, never invented alongside it.

Respond in EXACTLY this format and nothing else:

BEHAVIOUR: [What the person actually does, observable, in one plain sentence. No judgement words.]
STRENGTH: [The strength this behaviour is an over-play or under-play of, in a few words.]
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
    const strength = grab('STRENGTH')
    // Only use it if the two fields that carry the work both came back.
    if (behaviour && strength) {
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

  const SEVERITY_RULE = {
    DEVELOPMENTAL: 'This is ordinary development. Write it as an opportunity they have earned.',
    CORRECTIVE: 'A standard is being missed. Name the standard plainly and be unambiguous that it has to change. Warmth in the language, no softness in the message.',
    FORMAL: 'The manager has stated a consequence, a deadline, or a disciplinary process. Keep every one of those intact, in plain words, including any timescale they gave. Reframing changes how this reads, never how serious it is. Do not turn a warning into a conversation.',
  }[severity] || ''

  const reframeBlock = reframed
    ? `
WHAT IS ACTUALLY BEING SAID, read out of the manager's rough notes:
Behaviour: ${reframed.behaviour}
The strength it is an over-play or under-play of: ${reframed.strength}
Effect: ${reframed.effect}
Severity: ${severity}

Open on the strength above, stated as fact. Write the development as that same strength brought
into balance, never as a flaw to fix. Use the behaviour and the effect as the specifics. Do not
repeat the manager's own wording back if it was a judgement about the person, and never use their
insults, their sarcasm or their temper. Nothing here is a new fact: it is what the manager wrote,
read properly.

${SEVERITY_RULE}
`
    : ''

  const skillLabel = ['very low', 'low', 'medium', 'high', 'very high'][((skill || 3) - 1)]
  const confidenceLabel = ['very low', 'low', 'medium', 'high', 'very high'][((confidence || 3) - 1)]

  const systemPrompt = `You are an expert leadership coach helping managers deliver clear, constructive, and motivating feedback.

The leaders we remember are the ones who saw potential in us, challenged us to rise to it, and
supported us every step of the way. Write as one of those leaders would write.

You will generate TWO separate outputs. Separate them with exactly: ===GUIDE===

OUTPUT 1 — THE FEEDBACK
Generate feedback that:
- Is clear, direct, and human — sounds like a thoughtful manager, not a corporate document
- Is specific to the situation described — no generic praise or generic development points
- Leads from a genuine strength and frames the development as the next step up from that strength, never as a flaw to fix
- Reinforces the person's belief in their own ability by granting them earned trust and scope, not by reassuring them
- Is written in the selected register. The two registers produce genuinely different documents, not the same document with different adjectives. Follow the word counts. They are the instruction, not a guide.

  EMPATHETIC. 350 to 450 words. Give each of the five points below room: two or three sentences each. Name the effect their work has on the people around them, and describe what the shift will feel like from the inside. Vary your sentence length. Use their first name once, early. The warmth is in how much attention you give them, not in softening the language.

  DIRECT. 180 to 250 words. One sentence per point, two at the most. Say the development once, in a single clean sentence, and do not circle back to it. Describe standards and outcomes rather than feelings. Keep sentences under twenty words. Cut every qualifier: no "I think", "perhaps", "it might be worth", "one thing to consider", "I would encourage you to". The respect is in not wasting their time.

  Both registers follow the same five point structure below and the same cardinal rule. What changes is the length, the elaboration and the amount of qualification. Someone handed both versions should tell them apart at a glance, before reading a word.

STRUCTURE for the feedback. Plain prose only: no markdown, no asterisks, no bold, no ## headings, no bullet points, no backticks, no hashtags. No exclamation marks. UK English. Do not use em dashes (—): use a comma, a colon, or a full stop instead. Do not use the words "leverage", "empower", "unlock", "journey", "delve", "robust", "seamless", "inspire", or the phrase "moving forward".

Observe the cardinal rule: never pivot from the strength to the development with "however", "but", "that said", or any hinge that signals the praise was throat-clearing. The strength is the platform the development sits on, not a setup for criticism. Follow these points in order:
1. Open on a genuine, specific strength. State it plainly as fact, not as a compliment being banked.
2. Build on that strength: name the specific behaviours that are landing well and the value they create.
3. The shift: describe the one development as the next step up that adds to what they already do well. Frame it as increased scope, trust, or authority they are ready for. Where you can, describe the specific behaviour that closes the gap, phrased as something they do, not something they lack.
4. What this opens up for them: the opportunity the shift earns, how they will feel, and how they will be seen. Keep it specific to this person.
5. Close by granting something real: state plainly the trust, autonomy, or recognition they have earned. In the same breath ask for their view and what they want to do about it, so the next step is agreed between the two of you rather than handed down. End on what they have earned, not on a scheduled meeting and not on piled-on reassurance. The motivation comes from what you grant, not from encouragement. Do not use a rallying-cry line ("you've got this", "this is your chance to shine").

After the feedback, on a new line write exactly: ===CADENCE===
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

Use the strength above as the opening of the feedback, stated as fact, in the
manager's own terms. If a next step up is given, that is the development point:
frame it as something that adds to the strength, never as something they lack.
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

    return res.status(200).json({ result, guide })

  } catch (err) {
    console.error('Handler error:', err)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
}
