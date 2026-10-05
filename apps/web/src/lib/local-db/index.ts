// Public surface of the on-device database and the local vault.
export { LocalDb, type LocalDbState } from "./client";
export type { LocalDb as LocalDbHandle } from "./client";

export {
  createLedger,
  currencyLabel,
  currentMonth,
  formatDay,
  formatMoney,
  formatMonthLabel,
  formatSignedMoney,
  isSupportedCurrency,
  moneyToInput,
  parseMoney,
  SUPPORTED_CURRENCIES,
  today,
  type AccountWithTotals,
  type Ledger,
  type MonthlyTotals,
  type NewAccount,
  type NewTransaction,
} from "./repositories";

export {
  createBudget,
  createBudgets,
  currentBudget,
  removeBudgetLimit,
  setBudgetLimit,
  type BudgetLine,
  type BudgetRow,
  type BudgetWithProgress,
} from "./budgets";

export {
  createCategories,
  createReports,
  seedSuggestedCategories,
  SUGGESTED_CATEGORIES,
} from "./categories";

export { DEFAULT_CURRENCY } from "./profiles";

export {
  createProfile,
  listProfiles,
  setOnboarding,
  unlockProfile,
  updateProfileSettings,
  validateSecret,
} from "./profiles";

export {
  deriveVerifier,
  generateSalt,
  LockoutError,
  MIN_PASSWORD_LENGTH,
  PIN_LENGTH,
  PIN_PATTERN,
  profileIsLocked,
  remainingLockoutMs,
} from "./credentials";

export { createGoals, contributeToGoal, type GoalWithProgress } from "./goals";

export {
  confirmOccurrence,
  createRecurring,
  hasPending,
  listOccurrences,
  listUpcoming,
  OCCURRENCE_HORIZON_DAYS,
  skipOccurrence,
  summariseUpcoming,
  syncAllRules,
  syncRule,
  UPCOMING_WINDOW_DAYS,
  type NewRecurring,
  type OccurrenceRow,
} from "./occurrences";

export {
  dateInMonth,
  dayInMonth,
  daysBetween,
  daysInMonth,
  describeRule,
  nextOccurrence,
  parseDay,
  ruleFromDate,
} from "./recurrence";

export {
  buildBriefing,
  canCover,
  duePhrase,
  duePhraseShort,
  urgencyOf,
  type CoverAdvice,
  type DailyBriefing,
  type Urgency,
} from "./reminders";

export { VaultProvider, useAutoRefresh, useVault } from "./vault";

export { SCHEMA_VERSION } from "./schema";
export type {
  Account,
  AccountType,
  ACCOUNT_TYPES,
  Budget,
  BudgetFor,
  BudgetItem,
  BudgetPeriod,
  BUDGET_PERIODS,
  Category,
  CategoryGroup,
  CategoryKind,
  CATEGORY_KINDS,
  CredentialType,
  FinancialGoal,
  GoalStatus,
  MonthlyAnchor,
  MONTHLY_ANCHORS,
  OccurrenceStatus,
  OCCURRENCE_STATUSES,
  OnboardingStep,
  PlannedOccurrence,
  Profile,
  ProfileSettings,
  ProfileSummary,
  RecurrenceRule,
  RecurringFrequency,
  RecurringTransaction,
  Transaction,
  TransactionType,
} from "./schema";
