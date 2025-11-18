/**
 * Форматирование текста для Telegram
 */

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Разбивка длинного текста на части
 */
function splitMessage(text, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH) {
  if (text.length <= maxLength) {
    return [text];
  }

  const parts = [];
  let currentPart = '';

  // Разбиваем по параграфам
  const paragraphs = text.split('\n\n');

  for (const paragraph of paragraphs) {
    // Если параграф сам по себе слишком длинный
    if (paragraph.length > maxLength) {
      // Разбиваем по предложениям
      const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
      
      for (const sentence of sentences) {
        if (currentPart.length + sentence.length > maxLength) {
          if (currentPart) {
            parts.push(currentPart.trim());
            currentPart = '';
          }
          // Если предложение само слишком длинное - режем по словам
          if (sentence.length > maxLength) {
            const words = sentence.split(' ');
            for (const word of words) {
              if (currentPart.length + word.length + 1 > maxLength) {
                parts.push(currentPart.trim());
                currentPart = word;
              } else {
                currentPart += (currentPart ? ' ' : '') + word;
              }
            }
          } else {
            currentPart = sentence;
          }
        } else {
          currentPart += sentence;
        }
      }
    } else {
      // Обычный параграф
      if (currentPart.length + paragraph.length + 2 > maxLength) {
        parts.push(currentPart.trim());
        currentPart = paragraph;
      } else {
        currentPart += (currentPart ? '\n\n' : '') + paragraph;
      }
    }
  }

  if (currentPart) {
    parts.push(currentPart.trim());
  }

  return parts.length > 0 ? parts : [text.substring(0, maxLength)];
}

/**
 * Отправка длинного сообщения частями
 */
async function sendLongMessage(ctx, text, options = {}) {
  const parts = splitMessage(text);
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    
    // Добавляем индикатор частей если сообщений больше одного
    const partIndicator = parts.length > 1 ? `\n\n📄 Partea ${i + 1}/${parts.length}` : '';
    
    try {
      await ctx.reply(part + partIndicator, {
        ...options,
        // Убираем reply_markup для всех частей кроме последней
        reply_markup: isLast ? options.reply_markup : undefined,
      });
      
      // Небольшая задержка между сообщениями
      if (!isLast) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } catch (error) {
      console.error('Error sending message part:', error);
      throw error;
    }
  }
}

/**
 * Экранирование специальных символов Markdown
 */
function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/**
 * Форматирование кода
 */
function formatCode(code, language = '') {
  return '```' + language + '\n' + code + '\n```';
}

/**
 * Форматирование списка
 */
function formatList(items, ordered = false) {
  return items
    .map((item, index) => {
      const prefix = ordered ? `${index + 1}.` : '•';
      return `${prefix} ${item}`;
    })
    .join('\n');
}

/**
 * Обрезка текста с многоточием
 */
function truncate(text, maxLength = 100, suffix = '...') {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Форматирование времени
 */
function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes < 60) {
    return remainingSeconds > 0 
      ? `${minutes}m ${remainingSeconds}s` 
      : `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 
    ? `${hours}h ${remainingMinutes}m` 
    : `${hours}h`;
}

/**
 * Красивое форматирование размера файла
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Форматирование числа с разделителями
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

module.exports = {
  splitMessage,
  sendLongMessage,
  escapeMarkdown,
  formatCode,
  formatList,
  truncate,
  formatDuration,
  formatFileSize,
  formatNumber,
  TELEGRAM_MAX_MESSAGE_LENGTH,
};
