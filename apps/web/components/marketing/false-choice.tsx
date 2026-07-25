/**
 * The centrepiece: three approaches, five questions, scannable in five seconds.
 *
 * Built as ONE CSS grid rather than three independent stacks, so every row sits
 * on a shared line across all three columns whatever the copy length. That is
 * what stops a comparison going ragged, and it is the failure this table exists
 * to avoid.
 */

const ROWS = [
  {
    question: "Who sets the price",
    passive: "A formula, not a person",
    proprietary: "The operator",
    vortex: "The maker's own strategy",
  },
  {
    question: "How fast it updates",
    passive: "Only when arbitraged",
    proprietary: "Instantly, offchain",
    vortex: "Every quote, against a fresh reference price",
  },
  {
    question: "Who can change the spread",
    passive: "Nobody",
    proprietary: "The operator, at will",
    vortex: "The maker, within an immutable floor",
  },
  {
    question: "What stops abuse",
    passive: "Nothing to abuse",
    proprietary: "Reputation",
    vortex: "The contract reverts",
  },
  {
    question: "Who you must trust",
    passive: "The maths",
    proprietary: "The operator",
    vortex: "The maths, again",
  },
] as const;

const COLUMNS = ["Passive AMM", "Proprietary AMM", "Vortex"] as const;

export function FalseChoice() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[38rem]">
        {/* Header row. The Vortex column carries a tonal step, not a glow. */}
        <div className="grid grid-cols-[minmax(9rem,1.1fr)_repeat(3,minmax(0,1fr))] gap-px">
          <div />
          {COLUMNS.map((column, index) => {
            const isVortex = index === 2;
            return (
              <div
                key={column}
                className={`px-4 pb-3 pt-4 ${isVortex ? "panel-raised rounded-b-none" : ""}`}
              >
                <h3
                  className={`text-[15px] ${isVortex ? "text-cu" : "text-say-2"}`}
                >
                  {column}
                </h3>
              </div>
            );
          })}
        </div>

        <dl className="grid grid-cols-[minmax(9rem,1.1fr)_repeat(3,minmax(0,1fr))] gap-px">
          {ROWS.map((row) => (
            <div key={row.question} className="contents">
              <dt className="flex items-center px-4 py-3.5 text-sm text-say-2">
                {row.question}
              </dt>
              <dd className="flex items-center px-4 py-3.5 text-sm text-say-3">
                {row.passive}
              </dd>
              <dd className="flex items-center px-4 py-3.5 text-sm text-say-3">
                {row.proprietary}
              </dd>
              <dd className="panel-raised flex items-center rounded-none px-4 py-3.5 text-sm text-say-1">
                {row.vortex}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
