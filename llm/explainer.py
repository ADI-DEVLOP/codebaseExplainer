import os

from dotenv import load_dotenv

load_dotenv()

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
client = None


def get_client():
    global client

    if client is None:
        from groq import Groq

        client = Groq(api_key=os.getenv("GROQ_API_KEY"))

    return client


def explain_code(context, question):
    try:
        response = get_client().chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a senior software engineer. Explain code clearly "
                        "and in simple terms."
                    ),
                },
                {
                    "role": "user",
                    "content": f"""
Given the following code:

{context}

Answer this question clearly:
{question}
""",
                },
            ],
            max_completion_tokens=512,
            timeout=20,
        )
        return response.choices[0].message.content

    except Exception as e:
        error_name = e.__class__.__name__
        error_message = str(e)

        if error_name == "RateLimitError":
            return fallback_explanation(context, question)

        if error_name == "NotFoundError":
            return f"Model '{GROQ_MODEL}' not found. Check your .env file."

        if "GROQ_API_KEY" in error_message:
            return "GROQ_API_KEY is missing. Add it to your .env file."

        return f"Unexpected error: {error_message}"


def fallback_explanation(context, question):
    """
    Simple fallback when Groq is not available.
    """
    return f"""
Groq API rate limit reached.

Fallback explanation:

This code appears to be a React component.

It likely:
- Uses hooks like useState and useEffect
- Manages application state
- Renders UI components
- Handles user interactions

Based on the question:
{question}

Relevant snippet:
{context[:300]}
"""
