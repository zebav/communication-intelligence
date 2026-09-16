// Convert an explicit wall-clock value in an IANA zone, rejecting DST gaps.
export function zonedInstant(value:string,timezone:string) {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error("Ange datum och klockslag.");
  const wanted=value.length===16?value+":00":value;
  const numeric=Date.parse(wanted+"Z");
  if(!Number.isFinite(numeric)) throw new Error("Ogiltigt datum");
  const formatter=new Intl.DateTimeFormat("sv-SE",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const wall=(t:number)=>formatter.format(new Date(t)).replace(" ","T");
  let guess=numeric;
  for(let i=0;i<4;i++) guess+=numeric-Date.parse(wall(guess)+"Z");
  if(wall(guess)!==wanted) throw new Error("Klockslaget finns inte på grund av sommartidsomställning.");
  if(wall(guess-3600000)===wanted || wall(guess+3600000)===wanted) throw new Error("Klockslaget är tvetydigt vid vintertidsomställningen. Välj en annan tid.");
  return new Date(guess).toISOString();
}
