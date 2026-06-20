import { NextRequest } from "next/server";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

if (!NVIDIA_API_KEY) {
  console.warn("NVIDIA_API_KEY not set in environment");
}

const SYSTEM_PROMPT = `You are ClearLane AI, a traffic analysis assistant for Bengaluru Traffic Police. You help officers understand parking-induced congestion data.

You have access to current traffic data context. Answer questions about hotspots, violations, congestion patterns, and enforcement recommendations.

Be concise, specific, and use numbers from the data. You are talking to a traffic police officer who needs actionable insights. Keep responses under 4 sentences unless asked for detail.`;

export async function POST(request: NextRequest) {
  if (!NVIDIA_API_KEY) {
    return new Response(
      JSON.stringify({ error: "NVIDIA API key not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const { messages, context } = await request.json();

    const fullMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(context
        ? [
            {
              role: "user",
              content: `Current traffic data context:\n${JSON.stringify(context, null, 2)}`,
            },
            { role: "assistant", content: "I have the traffic data loaded. Ready to answer questions." },
          ]
        : []),
      ...messages,
    ];

    const response = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${NVIDIA_API_KEY}`,
        },
        body: JSON.stringify({
          model: "meta/llama-3.1-8b-instruct",
          messages: fullMessages,
          temperature: 0.3,
          max_tokens: 300,
          stream: true,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("NVIDIA API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: `NVIDIA API error: ${response.status}` }),
        { status: response.status, headers: { "Content-Type": "application/json" } },
      );
    }

    // Stream the response back to the client
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
