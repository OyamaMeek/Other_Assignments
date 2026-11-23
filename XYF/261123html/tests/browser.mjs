import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function run(page, { baseline = false } = {}) {
  const failures = [];
  const check = async (name, action) => {
    try {
      await action();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(name);
      console.log(`FAIL ${name}: ${error.message}`);
    }
  };
  await page.goto('http://127.0.0.1:4179');
  await page.click('nav button[data-tab="me"]');
  await page.click('#clr');
  await page.acceptDialog();
  await page.click('nav button[data-tab="home"]');

  await check('填空输入具有关联的标签', async () => {
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.blank input')].every(input => input.labels.length === 1)), true);
  });
  await check('十道题均可通过键盘选择', async () => {
    assert.equal(await page.evaluate(() => document.querySelectorAll('.qbar button').length), 10);
    await page.focus('.qbar button[data-j="3"]');
    await page.press('.qbar button[data-j="3"]', 'Enter');
    assert.match(await page.evaluate(() => document.querySelector('.qnote').textContent), /第 4/);
  });
  await check('速查保留特殊字符并按文本呈现', async () => {
    await page.click('nav button[data-tab="lib"]');
    const query = '\"><b>test</b>';
    await page.fill('#libSearch', query);
    assert.equal(await page.evaluate(() => document.querySelector('#libSearch').value), query);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#view b').length), 0);
    if (!baseline) {
      await page.fill('#libSearch', 'q235');
      assert.equal(await page.evaluate(() => document.querySelectorAll('.lib-item').length), 1);
      await page.fill('#libSearch', '');
      assert.equal(await page.evaluate(() => document.querySelectorAll('.lib-item').length), 46);
    }
  });
  await page.click('nav button[data-tab="home"]');

  if (!baseline) {
    await check('多视口四个页面无横向溢出，导航有当前状态', async () => {
      for (const width of [1440, 768, 390, 320]) {
        await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
        for (const tab of ['home', 'wrong', 'lib', 'me']) {
          await page.click(`nav button[data-tab="${tab}"]`);
          const layout = await page.evaluate(() => ({
            width: innerWidth,
            content: document.documentElement.scrollWidth,
            current: document.querySelector('nav [aria-current="page"]')?.dataset.tab,
            minNav: Math.min(...[...document.querySelectorAll('nav button')].map(button => button.getBoundingClientRect().height)),
            heading: document.querySelector('h1')?.textContent,
          }));
          assert.equal(layout.width, width, '浏览器必须使用目标宽度');
          assert.ok(layout.content <= layout.width, `${width}/${tab}: ${JSON.stringify(layout)}`);
          assert.equal(layout.current, tab);
          assert.ok(layout.minNav >= 44);
          assert.ok(layout.heading);
        }
      }
    });
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.click('nav button[data-tab="home"]');
    await check('答题进度刷新保留、全部十四天打卡与弹窗键盘操作', async () => {
      assert.equal(await page.evaluate(() => DOF.length), 14);
      assert.equal(await page.evaluate(() => MAT.length), 46);
      const layoutIssues = [];
      for (let day = 1; day <= 14; day++) {
        await page.cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          headings: [...document.querySelectorAll('h1,h2')].map(heading => ({
            text: heading.textContent,
            lines: heading.getBoundingClientRect().height / parseFloat(getComputedStyle(heading).lineHeight),
          })),
        }));
        if (layout.overflow || layout.headings.some(heading => heading.lines > 2.05)) layoutIssues.push({ day, ...layout });
        await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        const answers = await page.evaluate(() => answersOf(DOF[st.day - 1]));
        for (const [field, value] of Object.entries(answers)) {
          await page.fill(`input[data-f="${field}"]`, String(value));
        }
        await page.click('#dofCheck');
        assert.match(await page.evaluate(() => document.querySelector('.verdict').textContent), /8 \/ 8/);
        for (let i = 0; i < 10; i++) {
          await page.click(`.qbar button[data-j="${i}"]`);
          const correct = await page.evaluate(index => dayItems(st.day)[index].ci, i);
          const choice = day === 1 && i === 0 ? (correct + 1) % 4 : correct;
          await page.click(`.opt[data-k="${choice}"]`);
          assert.match(await page.evaluate(() => document.querySelector('.fb .hd').textContent), choice === correct ? /回答正确/ : /回答错误/);
          if (day === 1 && i === 0) {
            await page.reload();
            assert.match(await page.evaluate(() => document.querySelector('#mcount').textContent), /1 \/ 10/);
            assert.equal(await page.evaluate(() => document.querySelector('input[data-f="total"]').value), String(answers.total));
          }
        }
        assert.equal(await page.evaluate(() => document.querySelector('#subBtn').disabled), false);
        await page.click('#subBtn');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'mOk');
        await page.press('#mOk', 'Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'mWrong');
        await page.press('#mWrong', 'Escape');
        assert.equal(await page.evaluate(() => document.querySelector('#mask').classList.contains('on')), false);
        assert.equal(await page.evaluate(() => st.checkins.length), day);
      }
      assert.match(await page.evaluate(() => document.querySelector('.done-card').textContent), /14 天已完成/);
      assert.deepEqual(layoutIssues, [], '全部机构标题在 320px 下不超过两行且无横向溢出');
    });
    await check('错题真实记录可移除', async () => {
      await page.click('nav button[data-tab="wrong"]');
      assert.equal(await page.evaluate(() => document.querySelectorAll('.wq').length), 1);
      await page.click('.del');
      assert.match(await page.evaluate(() => document.querySelector('.empty').textContent), /还没有错题/);
    });
    await check('导出真实学习记录', async () => {
      await page.click('nav button[data-tab="me"]');
      const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
      await page.click('#exp');
      const download = await downloadPromise;
      const folder = fileURLToPath(new URL('../.work', import.meta.url));
      await mkdir(folder, { recursive: true });
      await download.saveAs(`${folder}/checkins.json`);
      const data = JSON.parse(await readFile(`${folder}/checkins.json`, 'utf8'));
      assert.equal(data.checkins.length, 14);
      assert.equal(data.checkins[0].score, 9);
    });
  }

  await check('清空后仍能继续答题', async () => {
    await page.click('nav button[data-tab="me"]');
    await page.click('#clr');
    await page.acceptDialog();
    await page.click('nav button[data-tab="home"]');
    await page.click('.opt[data-k="0"]');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.fb.on').length), 1);
  });
  if (!baseline) {
    await check('减少动态效果与高对比设置生效', async () => {
      await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-contrast', value: 'more' }] });
      await page.click('nav button[data-tab="me"]');
      assert.equal(await page.evaluate(() => document.querySelector('#view').getAnimations().length), 0);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#exp')).transitionDuration), '0s');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mute').trim()), '#36414e');
      await page.cdp('Emulation.setEmulatedMedia', { features: [] });
    });
    await check('file URL 可直接打开并呈现完整练习', async () => {
      await page.goto(new URL('../index.html', import.meta.url).href);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.blank input').length), 8);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.qbar button').length), 10);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('link[href],script[src],img[src]')].length), 0);
    });
    await page.goto('http://127.0.0.1:4179');
  }
  console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', failures }));
  assert.equal(failures.length, 0, failures.join('; '));
}
