const vscode = require('vscode')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

exports.activate = () => {
    const reportDirectory = path.resolve(__dirname, '../../../artifacts')
    if (fs.existsSync(path.join(reportDirectory, 'profile-check.json'))) return
    setTimeout(async () => {
        const root = path.resolve(__dirname, '../../..')
        const directory = path.join(root, 'artifacts')
        fs.mkdirSync(directory, { recursive: true })
        const evidence = { checkedAt: new Date().toISOString(), vscodeVersion: vscode.version }
        try {
            const workspace = vscode.workspace.workspaceFolders[0].uri.toString()
            const registry = JSON.parse(fs.readFileSync(path.join(root, 'portable/user-data/User/globalStorage/storage.json'), 'utf8'))
            const profileId = registry.profileAssociations.workspaces[workspace]
            const profile = registry.userDataProfiles.find(profile => profile.location === profileId)
            evidence.workspace = workspace
            evidence.profile = profile
            evidence.effectiveProfileMarker = vscode.workspace.getConfiguration('localTransformerSmoke').get('profileMarker')
            assert.equal(profile.name, 'Windows')
            assert.equal(profileId, '6d6f8e04')
            assert.equal(evidence.effectiveProfileMarker, 'Windows-6d6f8e04')
            assert.ok(vscode.extensions.getExtension('dakara.transformer').isActive)
            evidence.status = 'passed'
            const reportFile = path.join(directory, 'installed-smoke.json')
            if (!fs.existsSync(path.join(directory, 'installed-smoke.initial.json'))) fs.copyFileSync(reportFile, path.join(directory, 'installed-smoke.initial.json'))
            const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
            const result = report.results.find(result => result.name === 'Windows profile is isolated from the daily VS Code user data')
            result.status = 'passed'
            result.evidence = evidence
            delete result.error
            report.profileVerificationCorrection = 'Global storage is shared across profiles; verified the actual workspace association and a setting defined only in the Windows profile instead'
            report.passed = report.results.filter(result => result.status === 'passed').length
            report.failed = report.results.length - report.passed
            report.completedAt = new Date().toISOString()
            fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
            const markdown = ['# Transformer 本地安装测试', '',
                `VS Code ${report.vscodeVersion} · Windows profile · Transformer 1.12.2`, '',
                `通过 ${report.passed} 项，失败 ${report.failed} 项`, '',
                ...report.results.map(result => `- ${result.status === 'passed' ? '通过' : '失败'}：${result.name}`), '',
                'Profile 已通过真实工作区关联和 Windows 专属配置的实际生效值确认', '',
                '初次测试曾错误地假定扩展全局存储路径按 profile 分开，原始结果保留在 installed-smoke.initial.json', '',
                '此窗口使用独立的用户数据和扩展目录，正常窗口的原版插件保持不变', '',
                '可通过命令面板中的 Transform 命令继续手动测试', ''].join('\n')
            const markdownFile = path.join(directory, 'installed-smoke.md')
            fs.writeFileSync(markdownFile, markdown)
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(markdownFile), { preview: false })
        } catch (error) {
            evidence.status = 'failed'
            evidence.error = error.stack || String(error)
        }
        fs.writeFileSync(path.join(directory, 'profile-check.json'), JSON.stringify(evidence, null, 2))
    }, 1000)
}
