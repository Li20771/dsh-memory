# -*- coding: utf-8 -*-
"""为 kb/knowledge/vehicle-security（模块直接在根下）每篇文档插入「📌 定位评估」块。
幂等：重复运行只替换已有块。
"""
import argparse
import os
import sys
from pathlib import Path

# vault 路径跟着脚本走：<仓库根>/kb/knowledge/vehicle-security，可用 DSH_KB_VAULT 覆盖
VAULT = Path(os.environ.get("DSH_KB_VAULT") or (Path(__file__).resolve().parents[2] / "kb" / "knowledge" / "vehicle-security"))
STAMP = "2026-10-28"
MARK = "📌 定位评估（对齐 2028 届车载安全求职目标"

LV = {
    "red": ("🔴 重点建设", "important"),
    "yel": ("🟡 补充完善", "info"),
    "ok":  ("⚪ 合格保持", "note"),
    "low": ("🔵 放轻", "tip"),
}

DIR_RULES = {
    "01-computer-basics": ("red", "计算机系统底座 —— 「底层够宽」的第一根柱子。",
                           "原有 5 篇正文空白、缺 LAB-01，已全部补齐；另新增 Git 与嵌入式概念 2 篇。",
                           "保持。字节序 / 内存 / 进程 / 文件权限四篇要能现场解释；数据结构 4 篇够用即可。"),
    "02-programming": ("red", "编程底座：招聘第一位是 Python，C 要能读懂。",
                       "Python 原有 3 篇缺工程化，已补 04 / 05。",
                       "先 Python 后 C 阅读；汇编按放轻处理，不再加投入。"),
    "03-network": ("red", "计算机网络与安全基础 —— 把通信背景转成工程能力（抓包定位 + 漏洞成因解释）。",
                   "无（4 篇 + LAB-03 已达标）。", "保持；把 Wireshark 从「会用」练到「能定位」。"),
    "04-security-basics": ("red", "安全基础四件套：认证 / 授权 / 加密 / 完整性，加威胁建模与测试方法论。",
                           "测试方法论篇缺「用例设计方法 + 追溯矩阵」，已在 15-测试工程补齐。",
                           "保持；读完 02 后接 15-测试工程/01 与 /03。"),
    "05-cryptography": ("red", "汽车密码测试方向的正面战场。",
                        "原有 5 篇齐备，缺国密专题与密码模块测试方法，已补 06 / 07。",
                        "优先读 06 国密与 07 密码模块测试，对准密码测试岗面试题。"),
    "06-web-security": ("yel", "车联网连接 App / 云平台，接口与客户端安全必须有基础。",
                        "边界已明确：够用即可，不是主战场。",
                        "按「HTTP、接口鉴权、输入校验、OWASP 风险」的程度收手，不要投大部分时间。"),
    "07-reverse-engineering": ("low", "逆向属专项方向；先建嵌入式与系统基础，不抢着学深。",
                               "非当前招聘硬要求。",
                               "保留到「能看 Ghidra 伪代码、看得懂函数入口与调用」的水平，暂停加深。"),
    "08-firmware-analysis": ("yel", "固件基础对理解 ECU / T-BOX / OTA 升级包直接有用。",
                             "深度漏洞挖掘、芯片侧信道、硬件故障注入属更深入的专项。",
                             "读基础两篇 + 提取解包流程；实际挖掘延后。"),
    "09-can-bus": ("red", "第一优先：CAN 是车载安全测试的入口协议，招聘必问。",
                   "无（3 篇 + LAB-09 + P5/P6 项目已覆盖）。",
                   "保持，并把 LAB-09 真跑一遍；用 vcan 把零硬件路径走通。"),
    "10-vehicle-architecture": ("red", "汽车电子电气架构 —— 先知道「被测对象是什么、接口在哪」。",
                                "安全机制原先散落各处，已补 04-车载安全机制与验证。",
                                "保持；重点掌握部件职责、网络拓扑、外部接口清单。"),
    "11-vehicle-protocols": ("red", "车载网络协议：UDS 是核心，OTA 是第二项目的抓手。",
                             "OTA 原先无专项文档，已补 04-OTA升级流程与安全测试。",
                             "UDS 读到能写测试；LIN / FlexRAY / 车载以太网先建心智模型。"),
    "12-vehicle-standards": ("red", "合规验证方向的正面战场。",
                             "原文库 0 处提及 GB 44495 / GB 44496，已补 04 专篇。",
                             "优先 GB 44495 / 44496 → 测试项 → 证据的映射能力；ISO 26262 只需区分 Safety / Security。"),
    "13-vehicle-attack-surface": ("red", "威胁分析六问的入口：有哪些资产和接口、攻击者从哪里进。",
                                  "无（远程 / 近场 / 物理三篇 + LAB 已达标）。",
                                  "保持；先用文档级方法枚举攻击面，硬件实验等有设备再做。"),
    "14-tara": ("red", "产品安全工程的核心方法，也是合规验证的工作语言。",
                "无（方法论 + 可行性 + 工具链 + LAB 已达标）。",
                "保持；把它做成可面试讲解的成品（配 P16 / P19）。"),
    "15-test-engineering": ("red", "15-测试工程：应届生最容易忽视、招聘中最实用的一块。",
                            "原文库完全缺失，本轮新建整模块。",
                            "本季度内按 01→05 读完 + 做完 LAB-15，产出可进简历的测试报告。"),
    "tools": ("red", "边用边补的工具箱，不追求工具名堆砌。",
              "本仓库原先没有 tools/ 目录（46 条断链的根因之一），本轮整体新建。",
              "按主线项目需要安装；装不上的用等价替代，不阻塞进度。"),
    "projects": ("red", "项目是简历的主体；原则是「能落地，不堆数量」。",
                 "本仓库原先没有 projects/ 目录（断链根因），本轮新建并放 5 个求职项目。",
                 "把每个保留项目做成「代码 + 测试 + 报告 + 面试话术」四件套。"),
}

FILE_RULES = {
    "00-能力图谱与求职优先级.md": (
        "red", "全库总纲：体检报告 + 导航 + 优先级基准，其他文档的定位评估都由它派生。",
        "本轮据此定位出 10 项问题并完成回补。",
        "每日自动任务跑 `python ../../tools/kb-maintenance/kb.py all` 体检并补强；新增文档同步更新第六节模块总表。"),

    # ---- 01
    "01-computer-basics/00-学习路线图.md": (
        "red", "系统底座总览。", "5 篇空白正文与 LAB-01 已补齐；新增 15 / 16 两篇。",
        "按路线推进；数据结构 4 篇只需够用。"),
    "01-computer-basics/01-CPU工作原理.md": (
        "yel", "理解程序怎么跑、流水线与分支预测。", "**原文正文为空，本轮已补全**。",
        "概念够用即可，不必深挖微架构；Spectre 那节留作漏洞成因素材。"),
    "01-computer-basics/02-存储系统.md": (
        "yel", "缓存 / 内存层次概念。", "**原文正文为空，本轮已补全**。",
        "够用即可，重点转到内存管理与字节序。"),
    "01-computer-basics/03-总线与IO.md": (
        "yel", "总线与 I/O 概念，与车载总线衔接。", "**原文正文为空，本轮已补全**。",
        "够用即可；深入部分交给 09-CAN 与 11-车载协议。"),
    "01-computer-basics/04-中断机制.md": (
        "yel", "中断 / 异常处理概念，读嵌入式代码要用。", "**原文正文为空，本轮已补全**。",
        "够用即可，能解释「中断服务程序为什么不能阻塞」。"),
    "01-computer-basics/05-字节序详解.md": (
        "red", "GPT 明确要求的基础项：读车载报文字段、密码接口、CRC 计算的前提。",
        "**原文正文为空，本轮已补全**（这是本轮最关键的一处回补）。",
        "保持；配合 DBC 信号解析反复练，做到看报文能直接判字节序。"),
    "01-computer-basics/10-Linux操作基础.md": (
        "red", "招聘明确要求：grep / find / ps / ss / tcpdump 的初步定位能力。", "无。",
        "保持；把这几个命令练到能现场演示。"),
    "01-computer-basics/11-数组与链表.md": ("yel", "读代码用的数据结构常识。", "无。", "够用即可，不要过度投入。"),
    "01-computer-basics/12-栈与队列.md": ("yel", "读代码用的数据结构常识。", "无。", "够用即可。"),
    "01-computer-basics/13-哈希表.md": ("yel", "读代码 + 哈希概念工具。", "无。", "够用即可；哈希安全属性交给 05/03。"),
    "01-computer-basics/14-树与复杂度.md": ("yel", "复杂度直觉，评估脚本性能时有用。", "无。", "够用即可。"),
    "01-computer-basics/15-Git版本控制与协作.md": (
        "red", "GPT 明确要求：提交、分支、合并、回滚；也是「项目可复现」的证明。",
        "原文库无教学文档，本轮新增。",
        "本月内用真实项目走一遍分支-冲突-回滚，并整理规范 commit 历史。"),
    "01-computer-basics/16-嵌入式系统与RTOS基础.md": (
        "yel", "概念级补充（GPT：现在先理解概念，不必马上深入驱动开发）。",
        "原文库仅零星概念，本轮新增。",
        "读到能对话即可；用文末「什么时候需要深入」表控制投入。"),
    "01-computer-basics/LAB-01-实操记录.md": (
        "red", "实践记录：把命令变成肌肉记忆。", "原为断链目标（文件不存在），本轮补入。",
        "按记录执行并留存证据。"),

    # ---- 02
    "02-programming/00-学习路线图.md": ("red", "编程底座总览。", "Python 工程化已补 2 篇。", "先 Python 后 C 阅读；汇编按放轻处理。"),
    "02-programming/c-language/00-学习路线图.md": ("red", "C 语言学习入口。", "无。", "13 篇按序推进；重点是能读懂而不是能写嵌入式驱动。"),
    "02-programming/c-language/11-嵌入式C特性.md": ("yel", "嵌入式 C 常见写法，读固件代码时有用。", "无。", "够用即可（不必成为嵌入式开发工程师）。"),
    "02-programming/c-language/12-安全编码与MISRA.md": ("yel", "安全编码规范，与固件审计、代码评审衔接。", "无。", "当「代码审计清单」用，不必逐条背 MISRA。"),
    "02-programming/assembly/00-学习路线图.md": ("low", "汇编：非招聘硬要求，先放轻。", "不构成能力缺口。", "读到能看懂函数入口、参数传递、分支即可，暂停加深。"),
    "02-programming/assembly/01-汇编基础与x86寄存器.md": ("low", "汇编基础。", "无。", "够用即可。"),
    "02-programming/assembly/02-指令集与函数调用.md": ("low", "指令集与调用约定。", "无。", "够用即可；读懂调用约定对读 Ghidra 有帮助。"),
    "02-programming/assembly/03-安全视角与ARM汇编.md": ("low", "ARM 汇编与安全视角。", "无。", "够用即可；ARM 细节等确定做 ECU 方向再补。"),
    "02-programming/c-language/13-C++阅读入门.md": (
        "yel", "R1.10「C++ 可逐步补」的落点 —— 目标只到能读懂，不到能写。",
        "原文库 C++ 完全空白；SOME/IP、DDS、AUTOSAR AP、车机应用都是 C++，读不懂就看不了这些模块的代码。",
        "读完这篇就够用；真要写 C++ 再另开系列，不要在这里滑向学一门语言。"),
    "02-programming/python/00-学习路线图.md": ("red", "招聘第一位：Python 优先。", "已补 04 工程化与 05 接口/串口两篇。", "01→05 全部跑一遍，每周产出一个小工具。"),
    "02-programming/python/01-基础语法与数据类型.md": ("red", "Python 入口。", "无。", "保持；边学边写脚本，不要只看。"),
    "02-programming/python/02-文件与网络编程.md": ("red", "文件 / 网络 I-O，写测试工具的基础。", "无。", "保持；接 05 接口与串口自动化。"),
    "02-programming/python/03-安全脚本工具链.md": ("red", "安全脚本工具链。", "无。", "保持；把脚本改造成 pytest 驱动（见 04）。"),
    "02-programming/python/04-工程化与自动化测试.md": (
        "red", "与招聘直接对位：pytest + CLI + 数据清洗统计 + 结果报告。", "原文库完全没有，本轮新增。",
        "本季度内把现有脚本改造成 pytest 驱动并自动生成报告。"),
    "02-programming/python/05-接口与串口自动化测试.md": (
        "red", "与招聘直接对位：HTTP / TCP / UDP / 串口调用 + 批量测试。", "原文库没有，本轮新增。",
        "用 vcan + 模拟 ECU 写一套批量 UDS 测试，产出可复现证据。"),
    "02-programming/LAB-02-实操记录.md": ("red", "编程实践记录。", "无。", "按记录执行；每个实验留一份输出与脚本。"),

    # ---- 03
    "03-network/00-学习路线图.md": ("red", "计算机网络学习入口。", "无。", "按路线推进，重点把抓包定位练成条件反射。"),
    "03-network/03-网络安全基础.md": ("red", "网络安全基础：认证/授权/加密/完整性/日志 + 漏洞成因。", "标注 in-progress，需继续写完。", "补完；把「漏洞怎么产生、影响是什么、怎么复测」讲顺。"),
    "03-network/04-抓包分析.md": ("red", "抓包分析：车载远程攻击面排查的基本功。", "标注 in-progress，需继续写完。", "优先补完，并与 LAB-03 合并实操。"),

    # ---- 04
    "04-security-basics/02-安全测试方法论.md": (
        "red", "威胁建模与渗透测试方法论，与 15-测试工程互补。",
        "缺测试用例设计方法与追溯矩阵（已在 15-测试工程补齐）。",
        "读完本篇接 15-测试工程/01（用例设计）与 /03（追溯矩阵）。"),
    "04-security-basics/03-安全工具概览.md": ("yel", "工具全景图。", "无。", "知道有什么即可，用到再查具体手册。"),

    # ---- 05
    "05-cryptography/00-学习路线图.md": ("red", "密码学学习入口；「汽车密码测试」主线。", "已补 06 国密与 07 模块测试。", "优先 06 / 07，把密码测试岗面试题吃透。"),
    "05-cryptography/01-对称加密.md": ("red", "对称加密：SecOC / OTA 包加密的基础。", "SM4 只有一节，已由 06 补全。", "保持；读完接 06 国密。"),
    "05-cryptography/02-非对称加密.md": ("red", "RSA / ECC：OTA 签名与 TLS 的基础。", "SM2 缺专篇，已由 06 补全。", "保持；读完接 06 国密。"),
    "05-cryptography/03-哈希算法.md": ("red", "哈希与 Merkle 树：OTA 分块校验、安全启动的核心。", "SM3 缺专篇，已由 06 补全。", "保持；读完接 06 国密。"),
    "05-cryptography/04-数字签名与证书.md": ("red", "签名与 PKI：车云认证、V2X 假名证书。", "无。", "保持；接 07 的证书链与密钥生命周期测试方法。"),
    "05-cryptography/05-汽车密码学应用.md": ("red", "汽车密码学应用全景。", "无。", "保持；作为密码测试的「被测对象索引」。"),
    "05-cryptography/06-国密算法SM2-SM3-SM4.md": (
        "red", "招聘点名要求：RSA / ECC / SM2 / SM3 / SM4 与车载密码应用。", "原文库仅 SM4 一节，本轮新增专题。",
        "把 SM2 签名验签、SM3 摘要、SM4 加解密链路跑通并留证据（文中数值均已本机实测）。"),
    "05-cryptography/07-密码模块测试方法.md": (
        "red", "汽车密码测试的核心方法论：算法调用 / 配置 / 随机数 / 密钥管理才是出事点。", "原文库完全没有，本轮新增。",
        "按文中 9 个测试维度建向量库 + pytest 骨架，配 P11 项目落地。"),
    "05-cryptography/LAB-05-密码学实操.md": ("red", "密码学实操。", "无。", "按实验顺序执行并留输出。"),

    # ---- 06
    "06-web-security/00-学习路线图.md": ("yel", "Web 安全：车联网需要，但不是主战场。", "边界已明确。", "按「够用即可」执行，不要投大部分时间在普通网站渗透上。"),
    "06-web-security/02-API安全.md": ("red", "车联网 App / 云平台接口是真实攻击面。", "无。", "保持；重点接口鉴权、越权、输入校验、重放。"),
    "06-web-security/03-移动应用安全.md": ("red", "App 是车联网远程攻击面的主要入口之一。", "无。", "保持；重点证书固定、硬编码密钥、接口越权。"),
    "06-web-security/04-Web安全工具.md": ("yel", "Web 工具链。", "无。", "够用即可。"),

    # ---- 09~14 关键篇
    "09-can-bus/01-CAN总线基础.md": ("red", "CAN 物理层与帧结构，招聘必问。", "无。", "保持；配合 vcan 实操。"),
    "11-vehicle-protocols/01-UDS诊断协议深入.md": (
        "red", "UDS 是诊断安全的核心，也是虚拟 CAN/UDS 测试工具项目（第一项目）的主对象。", "无。",
        "保持；练到能自己写诊断扫描、会话越权与刷写流程测试。"),
    "11-vehicle-protocols/02-LIN与FlexRay协议.md": ("yel", "知道它们解决什么问题、与 CAN 的区别即可。", "无。", "够用即可。"),
    "11-vehicle-protocols/03-车载以太网与SOME-IP.md": ("yel", "先了解用途与基本通信模式，不必一开始钻研完整协议栈。", "无。", "够用即可；做 DoIP / SOME-IP 项目时再深入。"),
    "11-vehicle-protocols/04-OTA升级流程与安全测试.md": (
        "red", "OTA 专项 —— 简历「第二个项目」的技术依据，也是 GB 44496 的对位对象。", "原文库只零散提及，本轮新增专篇。",
        "读完直接接 P16-OTA 项目，产出测试矩阵与模拟结果。"),
    "10-vehicle-architecture/04-车载安全机制与验证.md": (
        "red", "把「常见车载安全措施」系统化成「机制 → 测试怎么设计 → 证据形式」对照表。", "原文库缺系统化对照，本轮新增。",
        "作为安全测试用例库的源头使用；背下冒烟 20 项。"),
    "12-vehicle-standards/00-学习路线图.md": ("red", "标准法规学习入口；合规验证方向主线。", "已补 04-GB 44495/44496 专篇。", "优先读 04，再把 01/02 的条款映射能力练成表格。"),
    "12-vehicle-standards/03-中国汽车安全法规与ISO-26262.md": (
        "red", "中国法规四层架构 + 准入流程；ISO 26262 部分只需区分 Safety / Security。",
        "原文未点名 GB 44495 / 44496，已由 04 补齐。", "重点掌握国标体系与准入流程；26262 不再加深。"),
    "12-vehicle-standards/04-GB44495与GB44496合规测试.md": (
        "red", "合规验证方向的主战场：GB 44495 / 44496，2026-07-01 起对新申请型式批准车型执行。",
        "原文库 0 处提及，本轮新增。", "把两份标准的「要求 → 测试方法 → 证据 → 判定」四列表做进 P19。"),
    "13-vehicle-attack-surface/01-远程攻击面分析.md": (
        "red", "远程攻击面：车联网最主要的入侵路径。",
        "原文有一处损坏的工具链接（Burp Suite 被截断成半个词），**本轮已修复**。",
        "保持；重点 T-BOX / 云端 API / Mobile App 三条链。"),
    "14-tara/00-学习路线图.md": ("red", "TARA 方法论入口。", "无。", "配 P16 / P19 一起做成可面试的成品。"),

    # ---- 15
    "15-test-engineering/00-学习路线图.md": ("red", "测试工程模块入口。", "本轮新建整模块。", "按 01→05 顺序读；LAB-15 四个实验必须做完。"),

    # ---- tools
    "tools/index.md": ("red", "工具箱总览。", "本仓库原先没有 tools/，本轮整体新建。", "按主线项目需要装；装不上的用等价替代。"),
    "tools/can-utils-vcan.md": ("red", "零硬件 CAN 环境：求职期成本最优解。", "本轮新增。", "照最简流程跑通一遍，作为所有 CAN 项目的地基。"),
    "tools/canoe.md": ("low", "CANoe 是行业事实标准，但专家级使用与昂贵培训证书不是当前门槛。", "工具未安装，用 vcan + python-can 等价替代。", "只记「原理等价 + 能自己写自动化」的面试答法，不投入学习时间。"),
    "tools/sqlmap.md": ("low", "SQL 注入自动化 —— 车联网相关性低。", "无。", "暂停投入，做 CTF 时再看。"),
    "tools/metasploit.md": ("low", "渗透框架 —— 车联网相关性低。", "无。", "暂停投入。"),
    "tools/pwntools.md": ("low", "CTF / 漏洞利用框架。", "无。", "暂停投入，做 CTF 时再看。"),
    "tools/ghidra.md": ("yel", "逆向分析，读伪代码够用即可。", "未安装（需 Java 17）。", "需要读固件时再装；不追求深入逆向。"),
    "tools/binwalk.md": ("yel", "固件解包与文件系统分析。", "无。", "保持基础用法即可。"),
    "tools/savvycan.md": ("yel", "CAN 报文的图形化抓包 / 回放 / DBC 解码工具；可视化与演示环节最有用。", "原 70 行偏薄；已补到 ~170 行（三种接入 / 六个操作 / 四个测试场景 / 与命令行分工 / 8 条坑）。", "有硬件再上；没硬件时用 candump + python-can + cantools 完成同样的事，别为装工具卡住主线。"),
    "tools/scapy.md": ("yel", "网络包构造与分析。", "无。", "用到再查。"),
    "tools/nmap.md": ("yel", "端口扫描与服务发现 —— 攻击面盘点的第一步。", "原 64 行偏薄；已补到 195 行（参数表 / 车载端口清单 / 实战序列 / NSE 取舍 / 8 条坑）。", "当清单核对工具用，不当漏洞扫描器；结果要落成资产台账。"),
    "tools/burp-suite.md": ("yel", "App ↔ 云平台 API 的测试代理；车联网只需基础，不追网站渗透。", "原 59 行偏薄；已补到 200 行（六类 API 测试场景 / 手机流量入代理 / 证据脱敏 / 8 条坑）。", "重点是「改一个字段看能不能操作别人车」，不是背功能菜单；做 App/API 测试时再装。"),
    "tools/wireshark.md": ("red", "抓包定位 —— 招聘明确列出的能力，也是证据链的第一手材料来源。", "原 55 行偏薄；已补到 219 行（过滤器速查 / 车载四场景 / tshark 证据化 / 8 条坑）。", "把过滤表达式练到条件反射；每个结论都要能给出过滤表达式 + pcap + 哈希。"),
    "tools/python-can.md": ("red", "Python CAN 通信库，虚拟 CAN/UDS 项目的第一依赖。", "无。", "保持；配合 vcan 使用。"),
    "tools/cantools.md": ("red", "DBC 解析与信号编解码。", "无。", "保持。"),
    "tools/udsoncan.md": ("red", "UDS 诊断协议栈，诊断安全测试的直接工具。", "无。", "保持；用它写批量诊断测试。"),
    "tools/environment-setup.md": ("red", "环境配置指南：一键搭 WSL2/Kali + 全工具链。", "无。", "保持；换机时按它重搭。"),
    "tools/toolchain-workflow.md": ("red", "工具链使用手册：从编译到抓包到 CAN 的状态与命令。", "无。", "保持；把 vcan 相关命令补进速查表。"),
    "tools/github-local-viewer.md": ("low", "自研 GitHub 本地查看器，元工具。", "无。", "有需要再推进。"),

    # ---- projects
    "projects/README.md": ("red", "项目入口；本轮新建 projects/ 并放入 5 个求职项目。", "本仓库原先没有 projects/（断链根因）。", "按「两个项目」原则执行。"),
    "projects/project-05-virtual-can/README.md": ("red", "求职建议里的「第一个项目」。", "已有代码与测试；缺 UDS 侧与测试报告。", "补 UDS 测试模块 + 一份完整测试报告。"),
    "projects/project-05-virtual-can/03-UDS测试模块设计.md": (
        "red", "P5 第二阶段设计：从「能收发 CAN」升级到「能测诊断」，是 R9.2 的设计部分。",
        "原 P5 只有 sniff/sender/parser，无诊断能力；本文件补 15 条用例矩阵 + 模拟 ECU 状态机 + 证据规范，代码与报告待执行。",
        "按用例矩阵写实现 → 跑通 → 出报告；跑完把 R9.2 从 🟡 改 ✅。"),
    "projects/project-05-virtual-can/05-面试展示.md": ("red", "P5 的面试话术成品。", "无。", "按新增的 UDS 部分补充讲法。"),
    "projects/project-06-dbc-analysis/README.md": ("red", "DBC 信号逆向 —— 证明逆向能力，与字节序/位运算直接挂钩。", "无。", "保持；把输出整理成可复现的一页。"),
    "projects/project-06-dbc-analysis/05-面试展示.md": ("red", "P6 的面试话术。", "无。", "保持。"),
    "projects/project-16-ota-security/README.md": ("red", "求职建议里的「第二个项目」首选：OTA 安全分析。", "本轮新建。", "2027 上半年完成，产出四件套并写进简历。"),
    "projects/project-16-ota-security/02-实验报告模板.md": ("red", "P16 报告模板，决定项目能不能被面试官看懂。", "本轮新建。", "按模板填真实执行结果，附证据路径。"),
    "projects/project-19-iso21434-audit/README.md": ("red", "合规验证方向抓手：ISO 21434 / GB 44495 / 44496 / UN R155 的审计模拟。", "本轮新建。", "与 12/04 一起完成，产出差距分析与映射表。"),
    "projects/project-19-iso21434-audit/02-实验报告模板.md": ("red", "审计报告模板。", "本轮新建。", "填真实抽样结果，让报告能被追问。"),
    "projects/project-11-sm234-crypto-test/README.md": ("red", "汽车密码测试方向抓手：SM2/SM3/SM4 向量 + 接口 + 负向/互通性。", "本轮新建。", "走密码方向时优先做。"),
    "projects/project-11-sm234-crypto-test/02-实验报告模板.md": ("red", "密码模块测试报告模板。", "本轮新建。", "填向量通过率、负向拒绝率、互通矩阵。"),
}

DEFAULT_RULE = ("ok", "仓库常规内容。", "无。", "保持。")


def resolve(rel: str):
    if rel in FILE_RULES:
        return FILE_RULES[rel]
    best = None
    first = rel.split("/")[0]
    if first in DIR_RULES:
        return DIR_RULES[first]
    for d, rule in DIR_RULES.items():
        if rel.startswith(d + "/"):
            if best is None or len(d) > len(best[0]):
                best = (d, rule)
    return best[1] if best else DEFAULT_RULE


def build_block(rule):
    key, pos, gap, act = rule
    label, callout = LV[key]
    return (f"> [!{callout}] " + MARK + f" · {STAMP}）\n"
            f"> - **优先级**：{label}\n"
            f"> - **定位**：{pos}\n"
            f"> - **缺口**：{gap}\n"
            f"> - **动作**：{act}\n")


def split_fm(text):
    if not text.startswith("---"):
        return "", text
    lines = text.split("\n")
    if lines[0].strip() != "---":
        return "", text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "\n".join(lines[: i + 1]), "\n".join(lines[i + 1:])
    return "", text


def strip_existing(body):
    lines = body.split("\n")
    out, i = [], 0
    while i < len(lines):
        if lines[i].startswith("> [!") and MARK in lines[i]:
            i += 1
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                i += 1
            while i < len(lines) and lines[i].strip() == "":
                i += 1
            while out and out[-1].strip() == "":
                out.pop()
            if i < len(lines) and lines[i].strip() != "":
                out.append("")
            continue
        out.append(lines[i])
        i += 1
    return "\n".join(out)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    targets = [p for p in sorted(VAULT.rglob("*.md"))
               if not any(s in p.parts for s in (".obsidian", ".workbuddy"))]
    written = unchanged = 0
    lv = {"red": 0, "yel": 0, "ok": 0, "low": 0}
    for p in targets:
        rel = p.relative_to(VAULT).as_posix()
        lv[resolve(rel)[0]] += 1
        raw = p.read_text(encoding="utf-8")
        fm, body = split_fm(raw)
        body = strip_existing(body)
        new = (fm + "\n\n" if fm else "") + build_block(resolve(rel)) + "\n" + body.lstrip("\n")
        if not new.endswith("\n"):
            new += "\n"
        if new == raw:
            unchanged += 1
            continue
        if not a.dry_run:
            p.write_text(new, encoding="utf-8", newline="\n")
        written += 1

    print(f"目标文件：{len(targets)}  写入：{written}  未变：{unchanged}")
    print("优先级分布：", lv)


if __name__ == "__main__":
    main()