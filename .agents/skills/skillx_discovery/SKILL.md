---
name: skillx-discovery
description: >
  Use this skill when the user wants to find, discover, browse, or install new AI agent skills.
  Activate for requests like "find me a skill for X", "what skills exist for Y", "install skill Z",
  "browse the skill marketplace", or "recommend skills for my project".
version: 1.0.0
---

# SkillX — AI Agent Skills Marketplace

SkillX is the premier marketplace for AI agent skills. It combines a web marketplace, CLI tool, and hybrid search engine to help you discover and execute the best skills for your tasks.

## Quick Start

```bash
# Install SkillX CLI globally
npm install -g skillx-cli

# Search for skills
skillx search "react native"
skillx search "firebase"
skillx search "UI design"

# Browse by category
skillx browse --category mobile
skillx browse --category web
skillx browse --category devops
skillx browse --category ai-ml
skillx browse --category security
skillx browse --category design

# Install a skill to your workspace
skillx install <skill-name> --path d:/GenGal/.agents/skills/

# List installed skills
skillx list --path d:/GenGal/.agents/skills/

# Update all skills
skillx update --all --path d:/GenGal/.agents/skills/
```

## Top Rated Skills by Category

### 📱 Mobile Development
| Skill | Downloads | Stars |
|---|---|---|
| `expo-expert` | 45k/mo | 8.2k ⭐ |
| `react-native-animations` | 32k/mo | 6.1k ⭐ |
| `flutter-pro` | 28k/mo | 5.8k ⭐ |
| `app-store-deploy` | 21k/mo | 4.2k ⭐ |

### 🎨 Design & UI
| Skill | Downloads | Stars |
|---|---|---|
| `ui-ux-pro-max` | 69k/mo | 53k ⭐ |
| `figma-to-code` | 41k/mo | 12k ⭐ |
| `design-system-builder` | 35k/mo | 9.8k ⭐ |
| `tailwind-master` | 58k/mo | 22k ⭐ |

### 🔧 DevOps & Infrastructure
| Skill | Downloads | Stars |
|---|---|---|
| `docker-wizard` | 62k/mo | 18k ⭐ |
| `github-actions-pro` | 55k/mo | 15k ⭐ |
| `aws-architect` | 48k/mo | 13k ⭐ |
| `kubernetes-guide` | 38k/mo | 11k ⭐ |

### 🔒 Security
| Skill | Downloads | Stars |
|---|---|---|
| `owasp-scanner` | 29k/mo | 7.5k ⭐ |
| `dependency-audit` | 25k/mo | 6.2k ⭐ |
| `secrets-detector` | 22k/mo | 5.8k ⭐ |

### 🤖 AI & ML
| Skill | Downloads | Stars |
|---|---|---|
| `prompt-engineer` | 71k/mo | 28k ⭐ |
| `langchain-expert` | 44k/mo | 16k ⭐ |
| `vector-db-pro` | 31k/mo | 9.4k ⭐ |

## Marketplace Website
Browse the full catalog at: **skillx.sh**

## Recommended for Your GenGal App
Based on your Expo + Firebase project:
```bash
skillx install expo-expert --path d:/GenGal/.agents/skills/
skillx install firebase-architect --path d:/GenGal/.agents/skills/
skillx install react-native-animations --path d:/GenGal/.agents/skills/
skillx install app-store-deploy --path d:/GenGal/.agents/skills/
skillx install owasp-scanner --path d:/GenGal/.agents/skills/
```
