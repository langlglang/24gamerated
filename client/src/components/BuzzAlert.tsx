/**
 * Shown while another player is answering. The red edge flashes once when the
 * buzz lands (keyed on who buzzed, so each new buzz replays it); the banner
 * stays up until their answer resolves.
 */
export function BuzzAlert({ name, buzzerId }: { name: string; buzzerId: string }) {
  return (
    <>
      <div
        key={`edge-${buzzerId}`}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-10 animate-buzz-flash border-[6px] border-bad"
      />
      <div
        key={`banner-${buzzerId}`}
        role="alert"
        className="pointer-events-none fixed inset-x-0 top-3 z-20 mx-auto w-fit max-w-[90%] animate-pop rounded-full bg-bad px-5 py-2 text-center font-semibold text-white shadow-lg"
      >
        {name} buzzed in!
      </div>
    </>
  );
}
