/**
 * SleepIn Web - 课表截图转 CSV 解析引擎 (Screenshot to CSV Engine)
 *
 * 核心机制：
 * 1. 结构化视觉 Prompt，指导多模态大模型（OpenAI / Gemini / 兼容接口）直接将高校教务课表截图提取为 SleepIn 格式。
 * 2. 文本智能解析器：针对复制的教务课表文本或 OCR 原始文本，通过正则与启发式算法提取课程名、星期、节次、地点、周次。
 * 3. 校验与标准化：转换为 SleepIn 规范的 CSV 格式（含 UTF-8 BOM，列名：课程名称,教师,地点,星期,开始节次,结束节次,周次）。
 */

import { COURSE_CSV_HEADERS, buildCsv } from './csv.js';
import { AI_CONFIG } from './config.js';

// 多模态 Vision Prompt 模板
export const VISION_SYSTEM_PROMPT = `你是一个高校课程表图像识别专家。你的任务是将用户上传的高校教务系统课表截图精确解析为符合 SleepIn 课表规范的结构化数据。

【输出规范】
请仅返回标准的 JSON 数组，严禁包含任何 Markdown 格式或额外解释，数组中每个元素包含以下字段：
- name: string (课程名称，去除无关修饰)
- teacher: string (授课教师，若无则留空字符串 "")
- location: string (上课教室或教学楼，若无则留空字符串 "")
- dayOfWeek: number (星期几，数字 1-7，1代表周一，7代表周日)
- startPeriod: number (开始节次，如第1节填 1)
- endPeriod: number (结束节次，如第2节填 2)
- weeks: string (周次规则，必须符合以下语法之一：
    * "1-16" 代表连续周
    * "1-16(odd)" 代表单周
    * "1-16(even)" 代表双周
    * "1;3;5;7" 代表分散周
    * "ALL" 代表整个学期所有周)

【注意事项】
1. 连堂课需合并：如一门课占第1、2节，startPeriod 为 1，endPeriod 为 2。
2. 同一门课不同时间段应拆分成多条记录。
3. 请仔细分辨截图中的课程名、教师、教室和周次信息。
4. 严格输出合法 JSON 数组，例如：
[
  {"name":"高等数学","teacher":"李老师","location":"理教201","dayOfWeek":1,"startPeriod":1,"endPeriod":2,"weeks":"1-16"},
  {"name":"大学英语","teacher":"王老师","location":"外语楼302","dayOfWeek":2,"startPeriod":3,"endPeriod":4,"weeks":"1-16(odd)"}
]`;

/**
 * 调用 OpenAI 兼容格式视觉接口解析图片（默认接入 Cloudflare Gemini 反向代理）
 */
export async function parseScreenshotWithVisionAPI({
  imageBase64,
  apiKey = '',
  endpoint = '',
  model = ''
}) {
  const activeEndpoint = (endpoint && endpoint.trim()) || AI_CONFIG.ENDPOINT;
  const activeModel = (model && model.trim()) || AI_CONFIG.DEFAULT_MODEL;
  const activeApiKey = (apiKey && apiKey.trim()) || '';

  // 补齐 data:image 前缀
  const dataUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  const headers = {
    'Content-Type': 'application/json'
  };

  if (activeApiKey) {
    headers['Authorization'] = `Bearer ${activeApiKey}`;
  }

  const response = await fetch(activeEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: activeModel,
      messages: [
        {
          role: 'system',
          content: VISION_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '请解析这张课程表截图中的所有课程记录，并按照要求的 JSON 数组格式输出：'
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl
              }
            }
          ]
        }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    let hint = '';
    if (response.status === 401 || response.status === 403) {
      hint = '\n\n【排查建议】：接口鉴权未通过。请确保已在 Cloudflare 后台设置 GEMINI_API_KEY 或 GEMINI_API_KEYS 变量。';
    }
    throw new Error(`API 请求失败 (${response.status}): ${errText}${hint}`);
  }

  const json = await response.json();
  const rawContent = json.choices?.[0]?.message?.content || '';

  // 安全提取 JSON 数组
  const arrayMatch = rawContent.match(/\[[\s\S]*\]/);
  const jsonStr = arrayMatch ? arrayMatch[0] : rawContent.trim();

  let records;
  try {
    records = JSON.parse(jsonStr);
  } catch (parseErr) {
    throw new Error(`模型返回内容无法解析为 JSON: ${parseErr.message}\n原始输出: ${rawContent.slice(0, 200)}...`);
  }

  if (!Array.isArray(records)) {
    throw new Error('接口返回格式异常：未能识别出课程记录数组');
  }

  return normalizeParsedRecords(records);
}

/**
 * 文本智能启发式提取器（适用于教务网页复制文本、纯文本课表或 OCR 文本）
 */
export function parseRawTimetableText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const records = [];

  // 星期正则匹配
  const dayRegex = /(?:周|星期|礼拜)([一二三四五六日天1-7])/;
  const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

  // 节次正则匹配：如 第1-2节, 1-2节, [01-02]
  const periodRegex = /(?:第)?\s*(\d{1,2})\s*[-~到至]\s*(\d{1,2})\s*(?:节|节次)?/;

  // 周次正则匹配：明确要求有"周"或带单双周括号，如 1-16周(单), 1-17周, 3-15周(双), 1-8周, 2-16(双)
  const weekRegex = /(\d{1,2})\s*[-~到至]\s*(\d{1,2})\s*(?:(?:周|周次)(?:\s*[(（](单|双|odd|even)[)）])?|[(（](单|双|odd|even)[)）])/i;

  let currentDay = 1;

  for (const line of lines) {
    // 检查是否单独行是星期
    const dayMatch = line.match(dayRegex);
    if (dayMatch && dayMatch[1]) {
      currentDay = dayMap[dayMatch[1]] || parseInt(dayMatch[1], 10) || 1;
    }

    // 先提取周次并从临时串中剔除，避免节次数字与周次数字相互误判
    let weeks = 'ALL';
    let cleanLine = line;
    const wMatch = line.match(weekRegex);
    if (wMatch) {
      const sW = wMatch[1];
      const eW = wMatch[2];
      const parity = wMatch[3] || wMatch[4];
      if (parity === '单' || parity === 'odd') {
        weeks = `${sW}-${eW}(odd)`;
      } else if (parity === '双' || parity === 'even') {
        weeks = `${sW}-${eW}(even)`;
      } else {
        weeks = `${sW}-${eW}`;
      }
      cleanLine = cleanLine.replace(wMatch[0], ' ');
    }

    const pMatch = cleanLine.match(periodRegex);
    if (pMatch) {
      const startP = parseInt(pMatch[1], 10);
      const endP = parseInt(pMatch[2], 10);

      // 尝试提取课程名（去除时间段文本）
      const courseName = cleanLine
        .replace(pMatch[0], ' ')
        .replace(dayRegex, ' ')
        .replace(/[【】\[\]()（）第节周]/g, ' ')
        .trim();

      // 分割可能的地点/教师
      const parts = courseName.split(/[@\s,，\t]+/).filter(Boolean);
      const name = parts[0] || '未知课程';
      const location = parts[1] || '';
      const teacher = parts[2] || '';

      records.push({
        name,
        teacher,
        location,
        dayOfWeek: currentDay,
        startPeriod: startP,
        endPeriod: endP,
        weeks
      });
    }
  }

  return normalizeParsedRecords(records);
}

/**
 * 校验并标准化提取结果
 */
function normalizeParsedRecords(records) {
  return records.map((r) => {
    let day = parseInt(r.dayOfWeek, 10);
    if (isNaN(day) || day < 1 || day > 7) day = 1;

    let startP = parseInt(r.startPeriod, 10);
    let endP = parseInt(r.endPeriod, 10);
    if (isNaN(startP) || startP < 1) startP = 1;
    if (isNaN(endP) || endP < startP) endP = startP;

    const weeks = String(r.weeks || 'ALL').trim() || 'ALL';

    return {
      name: (r.name || '未命名课程').trim(),
      teacher: (r.teacher || '').trim(),
      location: (r.location || '').trim(),
      dayOfWeek: day,
      startPeriod: startP,
      endPeriod: endP,
      weeks
    };
  });
}

/**
 * 将解析出的记录转换为符合 SleepIn 规范的标准 CSV
 */
export function convertRecordsToSleepInCsv(records) {
  const rows = records.map(r => [
    r.name,
    r.teacher,
    r.location,
    r.dayOfWeek,
    r.startPeriod,
    r.endPeriod,
    r.weeks
  ]);
  return buildCsv(COURSE_CSV_HEADERS, rows);
}
