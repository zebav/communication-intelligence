"use client";
import {useState} from "react";

export function ContactAvatar({personId,name,size=28}:{personId?:string;name:string;size?:number}){
 const [failed,setFailed]=useState(false);
 const initials=name.split(/\s+/).filter(Boolean).map(part=>part[0]).join("").slice(0,2).toUpperCase()||"?";
 if(!personId||failed)return <span className="contact-avatar-fallback" style={{width:size,height:size}} aria-hidden="true">{initials}</span>;
 return <span className="contact-avatar-wrap" style={{width:size,height:size}}><img src={`/api/vault/person-avatar/${encodeURIComponent(personId)}`} alt="" width={size} height={size} onError={()=>setFailed(true)} /></span>;
}
