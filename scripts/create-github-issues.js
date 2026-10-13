const fs = require('fs');
const https = require('https');

const REPO = 'sakshivavale/Linkup--Collaborative-Workspace';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

function parseUserStories(markdown) {
  const lines = markdown.split(/\r?\n/);
  let currentCategory = 'General';
  const stories = [];
  let currentStory = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect Category: ## 1. Authentication & Profile
    const catMatch = line.match(/^##\s+\d+\.\s+(.+)$/);
    if (catMatch) {
      if (currentStory) {
        stories.push(currentStory);
        currentStory = null;
      }
      currentCategory = catMatch[1].trim();
      continue;
    }

    // Detect Story Header: ### US-AUTH-01 — Sign Up
    const storyMatch = line.match(/^###\s+(US-[A-Z]+-\d+)\s*[—\-]\s*(.+)$/);
    if (storyMatch) {
      if (currentStory) {
        stories.push(currentStory);
      }
      currentStory = {
        id: storyMatch[1],
        name: storyMatch[2].trim(),
        category: currentCategory,
        lines: []
      };
      continue;
    }

    if (currentStory) {
      // If we encounter another section header or end of file
      if (line.match(/^##\s+/) && !line.match(/^###\s+/)) {
        stories.push(currentStory);
        currentStory = null;
      } else {
        currentStory.lines.push(line);
      }
    }
  }

  if (currentStory) {
    stories.push(currentStory);
  }

  return stories.map(s => {
    const rawBody = s.lines.join('\n').trim();
    const prioMatch = rawBody.match(/\*\*Priority:\*\*\s*(P[0-2])/);
    const priority = prioMatch ? prioMatch[1] : 'P0';

    // Map category to a short tag
    const catSlug = s.id.split('-')[1].toLowerCase();

    const body = `## ${s.id} — ${s.name}
**Module:** ${s.category}

${rawBody}

---
*Created from [user-stories.md](https://github.com/${REPO}/blob/main/docs/user-stories.md)*`;

    return {
      id: s.id,
      title: `${s.id}: ${s.name}`,
      category: s.category,
      priority,
      labels: ['user-story', priority, `area:${catSlug}`],
      body
    };
  });
}

function createGitHubIssue(story) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      title: story.title,
      body: story.body,
      labels: story.labels
    });

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO}/issues`,
      method: 'POST',
      headers: {
        'User-Agent': 'LinkUp-Issue-Generator',
        'Authorization': `token ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 201) {
          const parsed = JSON.parse(data);
          resolve({ success: true, number: parsed.number, url: parsed.html_url });
        } else {
          resolve({ success: false, status: res.statusCode, error: data });
        }
      });
    });

    req.on('error', err => reject(err));
    req.write(postData);
    req.end();
  });
}

async function run() {
  const mdPath = 'docs/user-stories.md';
  if (!fs.existsSync(mdPath)) {
    console.error(`File not found: ${mdPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(mdPath, 'utf-8');
  const stories = parseUserStories(content);

  console.log(`Parsed ${stories.length} user stories from ${mdPath}.`);
  console.log(`Starting GitHub issue creation for ${REPO}...\n`);

  let created = 0;
  let failed = 0;

  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    process.stdout.write(`[${i + 1}/${stories.length}] Creating issue for ${story.id}: ${story.title}... `);

    try {
      const res = await createGitHubIssue(story);
      if (res.success) {
        console.log(`Done (#${res.number}) -> ${res.url}`);
        created++;
      } else {
        console.log(`Failed! HTTP ${res.status}: ${res.error}`);
        failed++;
      }
    } catch (err) {
      console.log(`Error: ${err.message}`);
      failed++;
    }

    // Rate-limiting delay (600ms between requests)
    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`\n========================================`);
  console.log(`Summary: ${created} issues created successfully, ${failed} failed.`);
  console.log(`View issues at: https://github.com/${REPO}/issues`);
}

run();
