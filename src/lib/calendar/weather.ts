import {z} from "zod";
export const weatherRequestSchema=z.object({
 latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),
 at:z.iso.datetime({offset:true}),
}).strict();
export type WeatherRequest=z.infer<typeof weatherRequestSchema>;
export type WeatherAdvice={available:boolean;checkedAt:string;at:string;description?:string;minC?:number;maxC?:number;rainPercent?:number;windKph?:number;advice:string};
const period=z.object({interval:z.object({startTime:z.string(),endTime:z.string()}),weatherCondition:z.object({description:z.object({text:z.string()})}).optional(),precipitation:z.object({probability:z.object({percent:z.number().min(0).max(100)})}).optional(),wind:z.object({speed:z.object({value:z.number(),unit:z.string()})}).optional(),thunderstormProbability:z.number().optional()});
const daysSchema=z.object({forecastDays:z.array(z.object({daytimeForecast:period.optional(),nighttimeForecast:period.optional(),minTemperature:z.object({degrees:z.number(),unit:z.literal("CELSIUS")}).optional(),maxTemperature:z.object({degrees:z.number(),unit:z.literal("CELSIUS")}).optional()})).default([])});
export function summarizeWeather(raw:unknown,input:WeatherRequest,now=new Date()):WeatherAdvice {
 const at=Date.parse(input.at);const data=daysSchema.parse(raw);
 for(const day of data.forecastDays){
  const part=[day.daytimeForecast,day.nighttimeForecast].find(p=>p&&Date.parse(p.interval.startTime)<=at&&Date.parse(p.interval.endTime)>at);
  if(!part)continue;
  const rain=part.precipitation?.probability.percent,wind=part.wind?.speed.unit==="KILOMETERS_PER_HOUR"?part.wind.speed.value:undefined;
  const caution=(rain!==undefined&&rain>=40)||(wind!==undefined&&wind>=30)||(part.thunderstormProbability??0)>=20;
  return {available:true,checkedAt:now.toISOString(),at:input.at,description:part.weatherCondition?.description.text,minC:day.minTemperature?.degrees,maxC:day.maxTemperature?.degrees,rainPercent:rain,windKph:wind,
   advice:caution?"Välj gärna ett inomhusalternativ eller en plats med väderskydd. Kontrollera prognosen igen närmare mötet.":"Inget tydligt väderhinder i detta underlag, men det är ingen garanti för bra utomhusväder. Behåll ett inomhusalternativ."};
 }
 return {available:false,checkedAt:now.toISOString(),at:input.at,advice:"Ingen prognos täcker mötestiden. Välj inte utomhusplats utifrån antaget väder."};
}
export class GoogleWeather {
 constructor(private readonly key:string,private readonly reserve:()=>Promise<void>,private readonly transport:typeof fetch=fetch){}
 async forecast(raw:WeatherRequest):Promise<WeatherAdvice>{
  const input=weatherRequestSchema.parse(raw),now=new Date();
  if(Date.parse(input.at)<now.getTime()||Date.parse(input.at)>now.getTime()+10*86400000)return summarizeWeather({},input,now);
  await this.reserve();
  const url=new URL("https://weather.googleapis.com/v1/forecast/days:lookup");
  url.search=new URLSearchParams({"location.latitude":String(input.latitude),"location.longitude":String(input.longitude),days:"10",pageSize:"10",unitsSystem:"METRIC",languageCode:"sv"}).toString();
  const response=await this.transport(url,{headers:{"X-Goog-Api-Key":this.key},cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error("Väderprognosen kunde inte hämtas. Inget väder antas.");
  return summarizeWeather(await response.json(),input,now);
 }
}
