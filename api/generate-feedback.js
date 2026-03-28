export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { inputText, tone, override } = req.body || {}

  if (!inputText || !inputText.trim()) {
    return res.status(400).json({ error: 'Please enter your feedback notes before generating.' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured.' })
  }

  const SHARPENING_MARKER = '__NEEDS_SHARPENING__'

  const stage1 = override
    ? 'The manager has chosen to override the specificity check. Skip Stage 1 entirely and go straight to Stage 2 — generate feedback based on the notes as provided.'
    : 'Before generating any feedback, assess whether the manager\'s notes are specific enough to be useful.\n\nNotes are TOO VAGUE if they:\n- Describe a general trait without citing a specific situation or behaviour (e.g. "needs to improve communication", "is not a team player")\n- Fail to say what happened, when, or in what context\n- Give no sense of what standard is being missed or exceeded\n\nIf the notes are too vague, do NOT generate feedback. Instead:\n- Start your response with exactly: ' + SHARPENING_MARKER + '\n- Then explain briefly and plainly why more detail is needed (one sentence)\n- Then ask two or three targeted questions to get what you need — specifically: what happened, in what context, and what standard are they missing or exceeding\n\nIf the notes ARE specific enough, move to Stage 2.'

  const systemPrompt = `You are an expert leadership coach helping managers deliver clear, constructive, and motivating feedback.

Your job has two stages:

STAGE 1 — ASSESS SPECIFICITY
${stage1}

STAGE 2 — GENERATE FEEDBACK
Write feedback that:
- Is clear, direct, and human — sounds like a thoughtful manager, not a corporate document
- Is specific to the situation described — no generic praise or generic development points
- Balances what is working with what needs to develop
- Reinforces the person's belief in their own ability to improve
- Reflects the selected tone:
  - Empathetic: warm and supportive, still direct and honest
  - Direct: concise and professional, respectful but unambiguous

STRUCTURE — follow this exactly, using plain prose, not headings or bullet points:
1. Positive opening — acknowledge effort or a genuine strength
2. What's working well — specific, observed behaviours that are landing well
3. Development areas — specific, honest account of what needs to change and why it matters
4. What better looks like — concrete, practical description of improved performance
5. Encouraging close — genuine confidence in their ability to grow
6. Invitation to discuss — open-ended prompt to meet, discuss, and agree next steps together

After the feedback, on a new line write exactly: ===CADENCE===
Then write a cadence recommendation of two or three sentences covering: how often this person should receive feedback (weekly, fortnightly, monthly), in what format (informal conversation, structured one-to-one, written note), and why — based on the nature of the issue and the person's development stage.
On the next line, list three relevant cadence tags in square brackets — for example: [Weekly] [Informal one-to-one] [Probationary period]

WRITING RULES — apply to all output:
- UK English
- No jargon, no buzzwords
- No AI-sounding phrases: "carefully crafted", "leverage", "not just X but Y", "unlock potential", "journey", "moving forward", "going forward"
- No em dashes
- No bullet points in the feedback itself
- No headings — write in flowing paragraphs
- Sound human, direct, and genuinely helpful`

  const userPrompt = `Feedback style: ${tone || 'Empathetic'}

Manager's notes:
${inputText.trim()}`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1200,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    })

    if (response.status === 429 || response.status === 503) {
      return res.status(503).json({ error: 'The service is busy right now. Please try again in a moment.' })
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      console.error('OpenAI error:', errData)
      return res.status(500).json({ error: 'Something went wrong. Please try again.' })
    }

    const data = await response.json()
    const result = data.choices?.[0]?.message?.content || ''

    return res.status(200).json({ result })

  } catch (err) {
    console.error('Handler error:', err)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
}
