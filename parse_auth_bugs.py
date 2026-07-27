import json
with open('C:/Users/S Revanth Gopal/.gemini/antigravity/brain/5e613300-88e2-45a7-824c-33478b8b6ccf/.system_generated/logs/transcript_full.jsonl', 'r', encoding='utf-8') as f:
    with open('auth_bugs.txt', 'w', encoding='utf-8') as out:
        for line in f:
            data = json.loads(line)
            if data.get('type') == 'PLANNER_RESPONSE':
                for tc in data.get('tool_calls', []):
                    if tc.get('name') == 'send_message':
                        out.write(tc['args']['Message'])
