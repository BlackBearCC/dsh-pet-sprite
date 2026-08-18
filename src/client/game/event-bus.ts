/**
 * Character Engine — EventBus
 *
 * Typed event bus for character engine subsystems.
 * Replaces per-system callback arrays with a unified pub/sub mechanism.
 */

export type CharacterEventMap = {
  /** Attribute value crossed a level boundary */
  "attribute:level-change": { key: string; level: string; value: number; prev: string };
  /** Epiphany triggered in a domain */
  "skill:epiphany": { domainName: string; recentTopics: string[] };
  /** Attribute XP level up */
  "skill:attr-level-up": { key: string; name: string; level: number };
  /** Chat message count hit a round interval (every N messages) */
  "chat:interval": { count: number; interval: number; sessionKey?: string };
  /** Tick completed */
  tick: { deltaMs: number };
  /** Character interaction received */
  interact: { action: string; payload?: Record<string, unknown> };
  /** Character leveled up */
  "level:up": { level: number; prevLevel: number; title: string };
  /** EXP gained */
  "level:exp-gain": { amount: number; source: string; totalExp: number };
  /** Chat intent evaluated by LLM */
  "chat:eval": { intent: string; moodDelta: number; streak: number };
  /** Inventory item used */
  "inventory:use": {
    itemId: string;
    effects: Record<string, number>;
    special?: Record<string, unknown>;
  };
  /** Daily task completed */
  "daily:task-complete": { taskId: string; difficulty: string };
  /** Daily task reward claimed */
  "daily:task-claim": {
    taskId: string;
    reward: { exp: number; coins: number; items: Array<{ id: string; qty: number }> };
  };
  /** Care action performed */
  "care:action": {
    action: string;
    itemId?: string;
    effects: Record<string, number>;
    /** SLEEP 专属:睡眠时长(秒) */
    duration?: number;
    /** SLEEP 专属:唤醒原因 "natural" | "hungry" | "click" | "manual" */
    wokeBy?: string;
    /** SLEEP 专属:本次 mood 增量 */
    moodGain?: number;
    /** SLEEP 专属:本次 power 消耗 */
    powerCost?: number;
  };
  /** Login streak updated */
  "login:streak": { streak: number; date: string };
  /** User came back after being away 2+ days */
  "login:comeback": { daysSinceLastLogin: number; previousDate: string };
  /** Online 30 minutes reached (daily once) */
  "login:online30min": { minutes: number };
  /** Online 10 minutes reached (for newbie tasks) */
  "login:online10min": { minutes: number };
  /** Coins earned */
  "shop:coin-earn": { amount: number; source: string; balance: number };
  /** Coins spent */
  "shop:coin-spend": { amount: number; reason: string; balance: number };
  /** Item purchased from shop */
  "shop:buy": { itemId: string; qty: number; totalCost: number; balance: number };
  /** Soul Agent decided on an action */
  "soul:action": {
    type: string;
    text?: string;
    careAction?: string;
    emotion?: string;
    memory?: { fact: string; category: string };
  };
  /** World Agent generated an event */
  "world:event": { id: string; type: string; title: string; desc: string };
  /** Todo created */
  "todo:created": { todo: { id: string; title: string; category: string } };
  /** Todo completed by user */
  "todo:completed": { todo: { id: string; title: string; category: string } };
  /** Todo verified by AI */
  "todo:verified": {
    todo: { id: string; title: string; category: string };
    rewards: { exp?: number; coins?: number };
  };
  /** Todo deleted */
  "todo:deleted": { todo: { id: string; title: string } };
  /** Todos regenerated */
  "todo:regenerated": { cleared: number };
  /** Adventure started */
  "adventure:started": {
    adventure: { id: string; location: string; type: string; duration: number };
    costs?: { power: number; mood: number; health: number };
  };
  /** Adventure encounter triggered (narration/choice/discovery) */
  "adventure:encounter": {
    adventure: { id: string; location: string };
    encounter: {
      id: string;
      type: string;
      text: string;
      choices?: unknown;
      selectedChoice?: string;
      rollResult?: unknown;
      petDecided?: boolean;
      reward?: { item?: string; coins?: number };
    };
  };
  /** Adventure completed */
  "adventure:completed": {
    adventure: { id: string; location: string };
    result: {
      success: boolean;
      narrative: string;
      rewards: { exp: number; coins: number; items?: string[] };
      damage?: number;
    };
  };
  /** Adventure cancelled */
  "adventure:cancelled": { adventure: { id: string } };
  /** Adventure settlement → client bubble + chat summary */
  "adventure:settlement": {
    adventure: { id: string; location: string };
    result: {
      success: boolean;
      narrative: string;
      rewards: {
        exp: number;
        coins: number;
        items?: string[];
      };
      damage?: number;
    };
    summary: string;
  };
  /** Narrative session started */
  "narrative:started": {
    session: { id: string; scenarioId: string; title: string };
    costs?: { power: number; mood: number; health: number };
  };
  /** Narrative skill check performed */
  "narrative:check": { attribute: string; dc: number; success: boolean };
  /** Narrative session completed (won or lost) */
  "narrative:completed": {
    session: { id: string; scenarioId: string };
    outcome: {
      won: boolean;
      narrative: string;
      rewards: {
        exp: number;
        coins: number;
        moodDelta: number;
        skillXp: Record<string, number>;
      };
    };
  };
  /** Narrative session abandoned */
  "narrative:abandoned": { session: { id: string } };
  /** Triggered after narrative:completed; consumers should generate the NarrativeBook + memory triples. */
  "narrative:post-process": { sessionId: string };
  /** Narrative book created (post-process LLM run wrote a 叙事书 into inventory) */
  "narrative:book-created": {
    book: {
      id: string;
      title: string;
      scenarioId: string;
      scenarioTitle: string;
      tags: string[];
      wordCount: number;
      type: string;
      endings: string;
    };
  };
  /** Agent activity phase changed */
  "agent:phase": {
    phase: "idle" | "thinking" | "tool_call" | "streaming" | "long_work";
    toolName?: string;
    sessionKey?: string;
  };
  /** Achievement badge unlocked */
  "achievement:unlock": {
    id: string;
    name: string;
    description: string;
    icon: string;
  };
  /** Preference promoted to learned status */
  "profile:learned": {
    id: string;
    rule: string;
    recurrence: number;
    source: "correction" | "teach";
  };
  /** SkillRegistry: a skill became active (detected by agent activity) */
  "registry:activate": {
    skillId: string;
    skillName: string;
    suite?: string;
  };
  /** SkillRegistry: a skill became inactive */
  "registry:deactivate": {
    skillId: string;
  };
  /** SkillRegistry: interactive workflow started */
  "registry:workflow-start": {
    skillId: string;
    skillName: string;
    phases: string[];
  };
  /** SkillRegistry: workflow advanced to a new phase */
  "registry:workflow-phase": {
    skillId: string;
    phase: number;
    phaseName: string;
  };
  /** SkillRegistry: workflow ended (completed or cancelled) */
  "registry:workflow-end": {
    skillId: string;
    completed: boolean;
  };
  /** SkillRegistry: learned skill evolution projected into the pet state */
  "registry:evolution": {
    type: string;
    skillId: string;
    title: string;
    explanation: string;
  };
  /** A single lesson completed within a course */
  "learn:lesson-complete": {
    courseId: string;
    lessonOrder: number;
    lessonTitle: string;
    currentLesson: number;
    totalLessons: number;
    complexity?: number;
  };
  /** All lessons in a course are done (ready for exam) */
  "learn:all-lessons-done": {
    courseId: string;
    courseTitle: string;
    categoryName: string;
    complexity?: number;
  };
  /** 选修课修完一轮(无考试,可反复修) */
  "learn:elective-completed": {
    courseId: string;
    courseTitle: string;
    categoryName: string;
    subjectId?: string;
    timesCompleted: number;
  };
  /** PetClaw 工具首次被调用（游戏层首次登记） */
  "tool:first_use": { toolName: string; source: string; timestamp: number };
  /** RewardEngine 已把一条事件翻译成资源增量并派发完毕 */
  "reward:issued": {
    eventType: string;
    coins: number;
    exp: number;
    source: string;
  };
  /** Graduation exam passed */
  "learn:exam-passed": {
    courseId: string;
    courseTitle: string;
    categoryName: string;
    attempts: number;
    complexity?: number;
  };
  /** 观察模式: 用户自己在终端里用 agent CLI 开工了(只有元数据, 无内容原文) */
  "observed:work-begin": { source: string; project: string; cwd?: string };
  /** 观察模式: 观察到一次工具活动(target 只给文件 basename 或命令首词) */
  "observed:activity": { source: string; tool: string; target?: string };
  /** 观察模式: 会话安静了一阵(等输入/空闲) */
  "observed:work-pause": { source: string };
  /** 观察模式: 会话结束 */
  "observed:work-end": { source: string; ok?: boolean };
};

type EventHandler<T> = (data: T) => void;

export class EventBus {
  private _handlers = new Map<string, Set<EventHandler<unknown>>>();

  on<K extends keyof CharacterEventMap>(
    event: K,
    handler: EventHandler<CharacterEventMap[K]>,
  ): () => void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    const set = this._handlers.get(event)!;
    set.add(handler as EventHandler<unknown>);
    return () => set.delete(handler as EventHandler<unknown>);
  }

  emit<K extends keyof CharacterEventMap>(event: K, data: CharacterEventMap[K]): void {
    const set = this._handlers.get(event);
    if (!set) {
      return;
    }
    for (const handler of set) {
      try {
        handler(data);
      } catch (e) {
        console.error(`[character:event-bus] handler error for "${event}":`, e);
      }
    }
  }

  off<K extends keyof CharacterEventMap>(
    event: K,
    handler: EventHandler<CharacterEventMap[K]>,
  ): void {
    this._handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  removeAll(): void {
    this._handlers.clear();
  }
}
