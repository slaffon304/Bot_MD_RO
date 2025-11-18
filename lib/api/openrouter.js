/**
 * OpenRouter API Client
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 60000; // 60 секунд

/**
 * Отправка запроса в OpenRouter
 */
async function sendChatCompletion(messages, modelId, options = {}) {
  const {
    temperature = 0.7,
    maxTokens = 4000,
    stream = false,
    apiKey = process.env.OPENROUTER_API_KEY,
  } = options;

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/slaffon304/Bot_MD_RO',
        'X-Title': 'Bot MD RO',
      },
      body: JSON.stringify({
        model: modelId,
        messages: messages,
        temperature: temperature,
        max_tokens: maxTokens,
        stream: stream,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || 
        `OpenRouter API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    
    // Проверяем структуру ответа
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response from OpenRouter API');
    }

    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: data.usage,
      finishReason: data.choices[0].finish_reason,
    };

  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error('Request timeout - model took too long to respond');
    }
    
    console.error('OpenRouter API Error:', error);
    throw error;
  }
}

/**
 * Генерация изображения через DALL-E 3
 */
async function generateImage(prompt, options = {}) {
  const {
    size = '1024x1024',
    quality = 'standard',
    apiKey = process.env.OPENROUTER_API_KEY,
  } = options;

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/slaffon304/Bot_MD_RO',
      },
      body: JSON.stringify({
        model: 'openai/dall-e-3',
        prompt: prompt,
        n: 1,
        size: size,
        quality: quality,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || 
        `Image generation error: ${response.status}`
      );
    }

    const data = await response.json();
    
    if (!data.data || !data.data[0] || !data.data[0].url) {
      throw new Error('Invalid image generation response');
    }

    return {
      url: data.data[0].url,
      revisedPrompt: data.data[0].revised_prompt,
    };

  } catch (error) {
    console.error('Image Generation Error:', error);
    throw error;
  }
}

/**
 * Анализ изображения через vision модель
 */
async function analyzeImage(imageUrl, prompt, modelId = 'openai/gpt-4o', options = {}) {
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: prompt || 'Descrie această imagine în detaliu.',
        },
        {
          type: 'image_url',
          image_url: {
            url: imageUrl,
          },
        },
      ],
    },
  ];

  return await sendChatCompletion(messages, modelId, options);
}

/**
 * Проверка доступности модели
 */
async function checkModelAvailability(modelId, apiKey = process.env.OPENROUTER_API_KEY) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const model = data.data?.find(m => m.id === modelId);
    
    return !!model;
  } catch (error) {
    console.error('Model availability check error:', error);
    return false;
  }
}

/**
 * Получение списка доступных моделей
 */
async function getAvailableModels(apiKey = process.env.OPENROUTER_API_KEY) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Get models error:', error);
    return [];
  }
}

module.exports = {
  sendChatCompletion,
  generateImage,
  analyzeImage,
  checkModelAvailability,
  getAvailableModels,
  OPENROUTER_API_URL,
};
