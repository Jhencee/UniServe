const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
for (const file of ['User/user.js','Admin/admin.js','Landing/landing.js','Super Admin/super-admin.js']) {
  test(`${file} gives PWD and seniors equal priority and waits for scheduled appointments`, () => {
    const source = fs.readFileSync(path.resolve(__dirname,'../../..',file),'utf8');
    const context = {Date}; vm.createContext(context);
    vm.runInContext(source.match(/function isDue\([^]*?\n\}/)?.[0] || source.match(/function isDue\([^\n]+/)[0],context);
    // Extract each function independently; isDue is a single-line function.
    vm.runInContext(source.match(/function queueRank\([^]*?\n\}/)[0],context);
    const now = new Date('2026-10-12T10:00:00+08:00');
    for (const visitorType of ['Student','Guest']) {
      const pwd = {visitorType,source:'Walk-in',isPWD:true};
      assert.equal(context.queueRank(pwd,now),-1);
      assert.equal(context.queueRank(pwd,now),context.queueRank({source:'Walk-in',isSenior:true},now));
      assert.equal(context.queueRank({source:'Appointment',isPWD:true,scheduledAt:'2026-10-12T11:00:00+08:00'},now),3);
      assert.equal(context.queueRank({source:'Appointment',isPWD:true,scheduledAt:'2026-10-12T09:00:00+08:00'},now),-1);
    }
  });
}
