export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { inputText, tone, skill, confidence } = req.body || {}

  if (!inputText || !inputText.trim()) {
    return res.status(400).json({ error: 'Please enter your feedback notes before generating.' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured.' })
  }

  const skillLabel = ['very low', 'low', 'medium', 'high', 'very high'][((skill || 3) - 1)]
  const confidenceLabel = ['very low', 'low', 'medium', 'high', 'very high'][((confidence || 3) - 1)]

  const systemPrompt = `You are an expert leadership coach helping managers deliver clear, constructive, and motivating feedback.

You will generate TWO separate outputs. Separate them with exactly: ===GUIDE===

OUTPUT 1 — THE FEEDBACK
Generate feedback that:
- Is clear, direct, and human — sounds like a thoughtful manager, not a corporate document
- Is specific to the situation described — no generic praise or generic development points
- Balances what is working with what needs to develop
- Reinforces the person's belief in their own ability to improve
- Reflects the selected tone:
  - Empathetic: warm and supportive, still direct and honest
  - Direct: concise and professional, respectful but unambiguous

STRUCTURE for the feedback — plain prose, no headings, no bullet points:
1. Positive opening — acknowledge effort or a genuine strength
2. What's working well — specific, observed behaviours that are landing well
3. Development areas — specific, honest account of what needs to change and why it matters
4. What better looks like — concrete, practical description of improved performance
5. Encouraging close — genuine confidence in their ability to grow
6. Invitation to discuss — open-ended prompt to meet, discuss, and agree next steps together

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
- Always include this in "Before the conversation": Give the person advance notice of what you want to discuss. Do not ambush them with developmental feedback — it puts them on the defensive and closes down the conversation before it starts. A simple message the day before is enough: tell them you want to talk about their development and ask them to come ready to share their own view.
- Always include this in "Before the conversation" or "What to listen for": Ask for their view before you give yours. Good people are almost always harder on themselves than you would be. If you lead with your assessment, you lose the chance to hear theirs — and you lose the opportunity to let them arrive at the same conclusion themselves, which is far more powerful.
- Calibrate the rest of the advice based on skill and confidence level:
  - Low skill + low confidence: needs more structure, more encouragement, specific guidance on what good looks like, frequent check-ins
  - Low skill + high confidence: needs honest, direct feedback to recalibrate — be kind but clear, don't let confidence mask the skill gap
  - High skill + low confidence: needs reassurance, recognition of what they're already doing well, stretch challenges to rebuild belief
  - High skill + high confidence: can handle more autonomy, peer challenge, stretch goals — treat them as a partner in the conversation
- Write in plain prose, no bullet points, no jargon
- UK English throughout
- Sound like a thoughtful senior colleague, not a training manual`

  const userPrompt = `Feedback style: ${tone || 'Empathetic'}
Person's skill level: ${skillLabel}
Person's confidence level: ${confidenceLabel}

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
        max_tokens: 2000,
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
    const full = data.choices?.[0]?.message?.content || ''

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
