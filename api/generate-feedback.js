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
- They describe something that actually happened, with enough context to recognise it
- They point at a behaviour rather than a character judgement
- There is something the person could act on

Respond in EXACTLY this format and nothing else:

STATUS: [PASS or FAIL]
REASON: [One plain sentence. If FAIL, say what is missing.]
SHARPENED: [If FAIL, rewrite the notes with a specific occasion and observable behaviour, inventing the minimum plausible detail and keeping the manager's own judgement intact. If PASS, repeat the notes unchanged. Give it as a single short paragraph and write nothing after it.]`

    // Never block the manager on the check. If anything fails, let them through:
    // a sharpening suggestion is worth having and worth nothing if it stops work.
    const check = await complete({
      messages: [{ role: 'user', content: checkPrompt }],
      maxTokens: 500,
      temperature: 0.3,
      fast: true
    })
    return res.status(200).json({ text: check.ok && check.text ? check.text : 'STATUS: PASS' })
  }

  const skillLabel = ['very low', 'low', 'medium', 'high', 'very high'][((skill || 3) - 1)]
  const confidenceLabel = ['very low', 'low', 'medium', 'high', 'very high'][((confidence || 3) - 1)]

  const systemPrompt = `You are an expert leadership coach helping managers deliver clear, constructive, and motivating feedback.

You will generate TWO separate outputs. Separate them with exactly: ===GUIDE===

OUTPUT 1 — THE FEEDBACK
Generate feedback that:
- Is clear, direct, and human — sounds like a thoughtful manager, not a corporate document
- Is specific to the situation described — no generic praise or generic development points
- Leads from a genuine strength and frames the development as the next step up from that strength, never as a flaw to fix
- Reinforces the person's belief in their own ability by granting them earned trust and scope, not by reassuring them
- Reflects the selected tone:
  - Empathetic: warm and supportive, still direct and honest
  - Direct: concise and professional, respectful but unambiguous. Concise does not mean cold, and it does not mean pivoting straight to the criticism. The structure below applies in full to both tones.

STRUCTURE for the feedback. Plain prose only: no markdown, no asterisks, no bold, no ## headings, no bullet points, no backticks, no hashtags. No exclamation marks. UK English. Do not use em dashes (—): use a comma, a colon, or a full stop instead. Do not use the words "leverage", "empower", "unlock", "journey", "delve", "robust", "seamless", "inspire", or the phrase "moving forward".

Observe the cardinal rule: never pivot from the strength to the development with "however", "but", "that said", or any hinge that signals the praise was throat-clearing. The strength is the platform the development sits on, not a setup for criticism. Follow these points in order:
1. Open on a genuine, specific strength. State it plainly as fact, not as a compliment being banked.
2. Build on that strength: name the specific behaviours that are landing well and the value they create.
3. The shift: describe the one development as the next step up that adds to what they already do well. Frame it as increased scope, trust, or authority they are ready for. Where you can, describe the specific behaviour that closes the gap, phrased as something they do, not something they lack.
4. What this opens up for them: the opportunity the shift earns, how they will feel, and how they will be seen. Keep it specific to this person.
5. Close by granting something real: state plainly the trust, autonomy, or recognition they have earned, and fold any invitation to talk it through into that same close. End on what they have earned, not on a scheduled meeting and not on piled-on reassurance. The motivation comes from what you grant, not from encouragement. Do not use a rallying-cry line ("you've got this", "this is your chance to shine").

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

  const userPrompt = `Feedback style: ${tone || 'Empathetic'}
Person's skill level: ${skillLabel}
Person's confidence level: ${confidenceLabel}
${contextBlock}
Manager's notes:
${inputText.trim()}`

  try {
    const generated = await complete({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 2000,
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
      result = full.slice(0, guideIndex).trim()
      guide = full.slice(guideIndex + guideMarker.length).trim()
    }

    return res.status(200).json({ result, guide })

  } catch (err) {
    console.error('Handler error:', err)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
}
