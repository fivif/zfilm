export const importMessages = {
  en: {
    title: 'Your media folders',
    description: 'Import images, video, audio, Markdown, style documents and source code. The current agent describes and organizes each file.',
    footnote: 'Original files are kept. Imported copies are available under My media, and processing continues when Settings is closed.',
    import: 'Import folder', picking: 'Choosing folder…', currentAgent: 'Current agent', unavailable: 'Choose a connected agent in the chat before importing.',
    empty: 'Imported folders and their processing progress will appear here.',
    retry: 'Retry / process newly supported files', retrying: 'Retrying…', details: 'Files and processing log', logs: 'Processing log', noLogs: 'Waiting for processing logs…',
    agent: 'Agent', model: 'Model', success: 'completed', failed: 'failed', skipped: 'skipped', total: 'files', attempt: 'Attempt',
    importing: 'Importing files', queued: 'Waiting', running: 'Processing', succeeded: 'Completed', failedStatus: 'Needs retry',
    copied: 'Imported', itemFailed: 'Failed', itemSkipped: 'Skipped', progress: 'Folder processing progress',
  },
  'zh-CN': {
    title: '我的素材文件夹',
    description: '导入图片、音视频、Markdown、风格说明及代码文件，由当前 Agent 自动读取并整理。',
    footnote: '保留原文件，导入副本可在“我的素材”中使用。关闭设置后仍会继续处理。',
    import: '导入文件夹', picking: '正在选择文件夹…', currentAgent: '当前 Agent', unavailable: '请先在聊天中选择已连接的 Agent，再导入文件夹。',
    empty: '导入的文件夹和处理进度会显示在这里。',
    retry: '重试／补处理', retrying: '正在重试…', details: '文件与处理日志', logs: '处理日志', noLogs: '等待处理日志…',
    agent: 'Agent', model: '模型', success: '已完成', failed: '失败', skipped: '已跳过', total: '个文件', attempt: '尝试次数',
    importing: '正在导入', queued: '等待处理', running: '正在处理', succeeded: '处理完成', failedStatus: '需要重试',
    copied: '已导入', itemFailed: '失败', itemSkipped: '已跳过', progress: '文件夹处理进度',
  },
} as const;

export type ImportWords = { [K in keyof typeof importMessages.en]: string };
