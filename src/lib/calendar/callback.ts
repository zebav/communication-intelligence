// Use only the configured OAuth origin as a canonical destination. Never trust
// forwarded headers to construct an arbitrary redirect or send credentials.
export function calendarStartDestination(redirectUri:string, requestUrl:string, host:string|null) {
 const callback=new URL(redirectUri.trim());
 if(callback.protocol!=="https:") throw new Error("Calendar callback must use HTTPS");
 const request=new URL(requestUrl);
 return request.origin===callback.origin||host===callback.host ? null : `${callback.origin}${request.pathname}`;
}
