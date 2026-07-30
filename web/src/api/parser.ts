import { Task, Artifact } from './types';

export interface TimelineMessage {
  sender: 'user' | 'assistant' | 'system';
  text?: string;
  ts?: number;
  type: 'prompt' | 'logs' | 'ask' | 'answer' | 'artifacts';
  logs?: string[];
  artifacts?: Artifact[];
}

export function parseLogsToMessages(task: Task, logs: string[], artifacts: Artifact[]): TimelineMessage[] {
  const messages: TimelineMessage[] = [];
  
  // 1. Initial User Message
  messages.push({
    sender: 'user',
    text: task.text,
    ts: task.created,
    type: 'prompt'
  });
  
  // 2. Scan logs to build bubbles
  let currentSystemLogs: string[] = [];
  
  for (const line of logs) {
    if (line.startsWith('ask: ')) {
      // Flush system logs
      if (currentSystemLogs.length > 0) {
        messages.push({
          sender: 'system',
          logs: [...currentSystemLogs],
          type: 'logs'
        });
        currentSystemLogs = [];
      }
      messages.push({
        sender: 'assistant',
        text: line.substring(5),
        type: 'ask'
      });
    } else if (line.startsWith('answer: ')) {
      // Flush system logs
      if (currentSystemLogs.length > 0) {
        messages.push({
          sender: 'system',
          logs: [...currentSystemLogs],
          type: 'logs'
        });
        currentSystemLogs = [];
      }
      let ansText = line.substring(8);
      if (ansText.startsWith('User replied (free text): ')) {
        ansText = ansText.substring(26);
      } else if (ansText.startsWith('User chose: ')) {
        ansText = ansText.substring(12);
      }
      messages.push({
        sender: 'user',
        text: ansText,
        type: 'answer'
      });
    } else {
      currentSystemLogs.push(line);
    }
  }
  
  if (currentSystemLogs.length > 0) {
    messages.push({
      sender: 'system',
      logs: [...currentSystemLogs],
      type: 'logs'
    });
  }
  
  // 3. Append artifacts if any
  if (artifacts && artifacts.length > 0) {
    messages.push({
      sender: 'assistant',
      text: 'Hermes produced the following files/artifacts:',
      artifacts: artifacts,
      type: 'artifacts'
    });
  }

  return messages;
}
