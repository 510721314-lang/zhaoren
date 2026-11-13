// 规则体积门禁自测（T-7.34 ⑤）：用临时夹具跑真实门禁，锁定各判据不被改回旧口径
// 运行：node --test "scripts/*.test.js"（已挂进 npm test）
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'check-rules-size.js');
const INJECT_PATHS = ['.trae/rules/project-rules-core.md', '.trae/rules/project_rules-20261013.md', '.trae/rules/zhaoren-release-freeze.md'];
const bytesOf = (abs) => Buffer.from(fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), 'utf8').length;

// 构造最小合法夹具；overrides 支持整文件替换（值可为 string 或 (old)=>new）或 null 删除
// baselineOverride：null=按实际字节自动生成；'missing'=不写；函数(actualBytes)=>对象
function mkFixture(overrides = {}, baselineOverride = null) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zr-rules-'));
    const files = {
        '.trae/rules/project-rules-core.md': [
            '---', 'alwaysApply: true', '---', '',
            ...Array.from({ length: 10 }, (_, i) => `## ${i}. 核心节${i}`),
            '## 10–34. 索引式摘要',
            '- §10–§34 摘要占位',
            '## 附录A · 不可变红线',
            '- 订单 13 态状态机',
            '- 系统默认评价',
        ].join('\n'),
        '.trae/rules/project_rules-20261013.md': [
            '---', 'alwaysApply: true', '---', '',
            '- **§0–§9**：`.trae/rules/project-rules-core.md`',
            '- **§10–§34**：`.trae/documents/project-rules-full-20261029.md`',
            '- **指针**：`.trae/rules.md`',
        ].join('\n'),
        '.trae/rules/zhaoren-release-freeze.md': ['---', 'alwaysApply: true', '---', '', '# 冻结'].join('\n'),
        '.trae/rules.md': ['# 指针', '- `.trae/rules/project-rules-core.md`', '- `.trae/documents/project-rules-full-20261029.md`'].join('\n'),
        '.trae/documents/project-rules-full-20261029.md': Array.from({ length: 25 }, (_, i) => `## ${10 + i}. 归档节${10 + i}`).join('\n'),
    };
    for (const [p, content] of Object.entries(files)) {
        const abs = path.join(dir, p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    for (const [p, content] of Object.entries(overrides)) {
        const abs = path.join(dir, p);
        if (content === null) { if (fs.existsSync(abs)) fs.unlinkSync(abs); continue; }
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, typeof content === 'function' ? content(fs.readFileSync(abs, 'utf8')) : content, 'utf8');
    }
    const actual = INJECT_PATHS.reduce((a, p) => a + bytesOf(path.join(dir, p)), 0);
    const condActual = fs.existsSync(path.join(dir, '.trae/rules/miniprogram-config-guard.md'))
        ? bytesOf(path.join(dir, '.trae/rules/miniprogram-config-guard.md')) : 0;
    const archiveActual = bytesOf(path.join(dir, '.trae/documents/project-rules-full-20261029.md'));
    let baseline = baselineOverride;
    if (typeof baseline === 'function') baseline = baseline({ inject: actual, cond: condActual, archive: archiveActual });
    if (!baseline) {
        baseline = {
            injectBytes: actual, rateLimitBytes: 1024, staleToleranceBytes: 512,
            conditionalBytes: condActual, conditionalRateLimitBytes: 256,
            archiveFullBytes: archiveActual, archiveRateLimitBytes: 8192, pointerMaxBytes: 1200,
            l0: { maxFiles: 3, maxItems: 22, targetBytes: 12288 },
        };
    }
    const bAbs = path.join(dir, 'scripts/rules-size-baseline.json');
    fs.mkdirSync(path.dirname(bAbs), { recursive: true });
    if (baseline !== 'missing') fs.writeFileSync(bAbs, JSON.stringify(baseline), 'utf8');
    return dir;
}

function run(root) {
    const r = spawnSync(process.execPath, [GATE], { env: { ...process.env, RULES_ROOT: root }, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function withFixture(overrides, baselineOverride, fn) {
    const dir = mkFixture(overrides, baselineOverride);
    try { return fn(run(dir)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('基线夹具应 PASS（防止测试本身失真）', () => {
    withFixture({}, null, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
        assert.match(out, /RULES-SIZE OK/);
    });
});

test('N1 [CORE] core 缺 §N 核心节', () => {
    withFixture({ '.trae/rules/project-rules-core.md': t => t.replace('## 3. 核心节3', '') }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[CORE\]/);
    });
});

test('N2 [COVERAGE] 区间上界缩到 33 后 §34 失去覆盖', () => {
    withFixture({ '.trae/rules/project_rules-20261013.md': t => t.replace(/§10–§34/g, '§10–§33') }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[COVERAGE\] §34/);
    });
});

test('N3 [ARCHIVE] 归档缺 §N 正文节', () => {
    withFixture({ '.trae/documents/project-rules-full-20261029.md': t => t.replace('## 34. 归档节34', '') }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[ARCHIVE\]/);
    });
});

test('N4 [ORPHAN] 无 front-matter 且无引用的规则文件', () => {
    withFixture({ '.trae/rules/zz-orphan.md': '# 孤儿规则' }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[ORPHAN\] .*zz-orphan\.md/);
    });
});

test('N5 [CONDITIONAL] globs 定向桶超 2KB', () => {
    withFixture({ '.trae/rules/miniprogram-config-guard.md': `---\nalwaysApply: false\nglobs: miniprogram/**\n---\n${'x'.repeat(2100)}` }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[CONDITIONAL\]/);
    });
});

test('N6 [SIZE] 注入桶超 30KB 硬上限', () => {
    withFixture({ '.trae/rules/project-rules-core.md': t => t + '\n' + 'y'.repeat(35000) }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[SIZE\]/);
    });
});

test('N7 CRLF 检出不应假红（LF 归一化仍 PASS）', () => {
    withFixture({
        '.trae/rules/project-rules-core.md': t => t.replace(/\n/g, '\r\n'),
        '.trae/rules/project_rules-20261013.md': t => t.replace(/\n/g, '\r\n'),
        '.trae/rules/zhaoren-release-freeze.md': t => t.replace(/\n/g, '\r\n'),
    }, null, ({ code, out }) => {
        assert.strictEqual(code, 0, out);
        assert.match(out, /RULES-SIZE OK/);
    });
});

test('N8 [RULESMD] 指针文件缺少对 core 的引用', () => {
    withFixture({ '.trae/rules.md': '# 指针\n- 无引用' }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[RULESMD\]/);
    });
});

test('N9 [RATE] 净增超 1KB/commit', () => {
    withFixture({}, ({ inject }) => ({ injectBytes: inject - 1500, rateLimitBytes: 1024, staleToleranceBytes: 512, l0: { maxFiles: 3, maxItems: 22, targetBytes: 12288 } }), ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[RATE\]/);
    });
});

test('N10 [QUOTA] 已超 12KB 目标位仍净增', () => {
    withFixture({ '.trae/rules/project-rules-core.md': t => t + '\n' + 'z'.repeat(12000) }, ({ inject }) => ({ injectBytes: inject - 500, rateLimitBytes: 2048, staleToleranceBytes: 512, l0: { maxFiles: 3, maxItems: 22, targetBytes: 12288 } }), ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[QUOTA\]/);
    });
});

test('N11 [L0-FILES] 常驻注入文件超 3 个', () => {
    withFixture({
        '.trae/rules/extra0.md': '---\nalwaysApply: true\n---\n# extra',
        '.trae/rules/extra1.md': '---\nalwaysApply: true\n---\n# extra',
    }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[L0-FILES\]/);
    });
});

test('N12 [L0-ITEMS] core 常驻章节超 22 条', () => {
    withFixture({ '.trae/rules/project-rules-core.md': t => t + '\n' + Array.from({ length: 12 }, (_, i) => `## 附加${i}`).join('\n') }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[L0-ITEMS\]/);
    });
});

test('N13 [BASELINE] 缺水位文件应 fail-closed', () => {
    withFixture({}, 'missing', ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[BASELINE\]/);
    });
});

test('N14 [POINTER-BODY] rules.md 指针被写回正文（出现章节标题）', () => {
    withFixture({ '.trae/rules.md': '# 指针\n## 正文\n- `.trae/rules/project-rules-core.md`\n- `.trae/documents/project-rules-full-20261029.md`' }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[POINTER-BODY\]/);
    });
});

test('N15 [POINTER-SIZE] rules.md 超指针上限', () => {
    withFixture({ '.trae/rules.md': `# 指针\n${'x'.repeat(1300)}\n- \`.trae/rules/project-rules-core.md\`\n- \`.trae/documents/project-rules-full-20261029.md\`` }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[POINTER-SIZE\]/);
    });
});

test('N16 [RATE-COND] conditional 净增超速率门', () => {
    const guard = `---\nalwaysApply: false\nglobs: miniprogram/**\n---\n${'c'.repeat(400)}`;
    withFixture({ '.trae/rules/miniprogram-config-guard.md': guard }, ({ inject, cond, archive }) => ({
        injectBytes: inject, rateLimitBytes: 1024, staleToleranceBytes: 512,
        conditionalBytes: cond - 400, conditionalRateLimitBytes: 256,
        archiveFullBytes: archive, archiveRateLimitBytes: 8192, pointerMaxBytes: 1200,
        l0: { maxFiles: 3, maxItems: 22, targetBytes: 12288 },
    }), ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[RATE-COND\]/);
    });
});

test('N17 [RATE-ARCHIVE] 全量归档净增超速率门', () => {
    withFixture({ '.trae/documents/project-rules-full-20261029.md': t => t + '\n' + 'a'.repeat(9000) }, ({ inject, archive }) => ({
        injectBytes: inject, rateLimitBytes: 1024, staleToleranceBytes: 512,
        conditionalBytes: 0, conditionalRateLimitBytes: 256,
        archiveFullBytes: archive - 9000, archiveRateLimitBytes: 8192, pointerMaxBytes: 1200,
        l0: { maxFiles: 3, maxItems: 22, targetBytes: 12288 },
    }), ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[RATE-ARCHIVE\]/);
    });
});

test('N18 [SUMMARY-GAP] §10+ 有归档正文但 core 摘要未覆盖', () => {
    withFixture({ '.trae/rules/project-rules-core.md': t => t.replace('- §10–§34 摘要占位', '- §10–§33 摘要占位') }, null, ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[SUMMARY-GAP\] §34/);
    });
});

test('N19 [L0-HEADROOM] 余量 <512B 出近限告警（EXIT 仍 0）', () => {
    withFixture({}, ({ inject, cond, archive }) => ({ injectBytes: inject, rateLimitBytes: 1024, staleToleranceBytes: 512, conditionalBytes: cond, conditionalRateLimitBytes: 256, archiveFullBytes: archive, archiveRateLimitBytes: 8192, pointerMaxBytes: 1200, l0: { maxFiles: 3, maxItems: 22, targetBytes: inject + 100 } }), ({ code, out }) => {
        assert.strictEqual(code, 0, out);
        assert.match(out, /L0-HEADROOM.*100B/);
    });
});

test('N20 [TARGET-CAP] targetBytes 超 20KB 上界即 FAIL', () => {
    withFixture({}, ({ inject, cond, archive }) => ({ injectBytes: inject, rateLimitBytes: 1024, staleToleranceBytes: 512, conditionalBytes: cond, conditionalRateLimitBytes: 256, archiveFullBytes: archive, archiveRateLimitBytes: 8192, pointerMaxBytes: 1200, l0: { maxFiles: 3, maxItems: 22, targetBytes: 21000 } }), ({ code, out }) => {
        assert.strictEqual(code, 1);
        assert.match(out, /FAIL \[TARGET-CAP\]/);
    });
});
