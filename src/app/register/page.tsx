"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, RecaptchaVerifier, sendEmailVerification, signInWithPhoneNumber, signInWithPopup, signOut, type ConfirmationResult, type User } from "firebase/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, firebaseConfigError } from "../firebase";

const API=(process.env.NEXT_PUBLIC_API_BASE_URL||"http://localhost:8000").replace(/\/$/,"");
type Provider="email"|"google"|"phone";
type Stage="identity"|"verify"|"wizard";
function readableAuthError(error:unknown):string {
 const code=(error as {code?:string})?.code;
 if(code==="auth/billing-not-enabled")return "Firebase needs a linked Cloud Billing account to send real SMS codes. For testing, configure a test phone number in Firebase Authentication.";
 if(code==="auth/invalid-phone-number")return "Enter a valid phone number in international format, for example +919876543210.";
 if(code==="auth/too-many-requests")return "Firebase temporarily blocked requests from this device. Please wait before trying again.";
 return (error as Error)?.message||"Authentication failed.";
}
export default function RegisterPage(){
 const router=useRouter();
 const [provider,setProvider]=useState<Provider>("email");
 const [org,setOrg]=useState(""); const [name,setName]=useState("");
 const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [phone,setPhone]=useState(""); const [otp,setOtp]=useState("");
 const [departments,setDepartments]=useState<{name:string;description:string}[]>([]); const [departmentDraft,setDepartmentDraft]=useState(""); const [departmentDescription,setDepartmentDescription]=useState("");
 const [roles,setRoles]=useState<{name:string;description:string}[]>([]); const [roleDraft,setRoleDraft]=useState(""); const [roleDescription,setRoleDescription]=useState("");
 const [wizardStep,setWizardStep]=useState<1|2|3>(1);
 const [confirmation,setConfirmation]=useState<ConfirmationResult|null>(null);
 const [user,setUser]=useState<User|null>(auth?.currentUser??null);
 const [stage,setStage]=useState<Stage>("identity"); const [busy,setBusy]=useState(false); const [error,setError]=useState(firebaseConfigError); const [notice,setNotice]=useState("");
 const recaptcha=useRef<RecaptchaVerifier|null>(null);
 useEffect(()=>{if(!auth)return;const unsub=onAuthStateChanged(auth,u=>{setUser(u);if(u){if(u.email&&!u.emailVerified)setStage("verify");else setStage("wizard");}else setStage("identity");});return()=>{unsub();recaptcha.current?.clear();recaptcha.current=null;};},[]);
 function verifier(){if(!auth)throw new Error(firebaseConfigError);if(!recaptcha.current)recaptcha.current=new RecaptchaVerifier(auth,"register-recaptcha",{size:"invisible"});return recaptcha.current;}
 async function run(action:()=>Promise<void>){setBusy(true);setError("");setNotice("");try{await action();}catch(e){setError(readableAuthError(e));if(["auth/billing-not-enabled","auth/too-many-requests"].includes((e as {code?:string})?.code||"")){recaptcha.current?.clear();recaptcha.current=null;}}finally{setBusy(false);}}
 async function emailSignup(e:FormEvent<HTMLFormElement>){e.preventDefault();await run(async()=>{if(!auth)throw new Error(firebaseConfigError);const c=await createUserWithEmailAndPassword(auth,email.trim(),password);await sendEmailVerification(c.user);setUser(c.user);setStage("verify");setNotice("Verification email sent.");});}
 async function googleSignup(){await run(async()=>{if(!auth)throw new Error(firebaseConfigError);const c=await signInWithPopup(auth,new GoogleAuthProvider());setUser(c.user);setName(c.user.displayName||"");setEmail(c.user.email||"");setStage("wizard");});}
 async function sendCode(){await run(async()=>{if(!auth)throw new Error(firebaseConfigError);setConfirmation(await signInWithPhoneNumber(auth,phone.trim(),verifier()));setNotice("SMS code sent.");});}
 async function verifyCode(){await run(async()=>{if(!confirmation)throw new Error("Request an SMS code first.");const c=await confirmation.confirm(otp.trim());setUser(c.user);setStage("wizard");});}
 function addName(kind:"department"|"role"){
  const value=(kind==="department"?departmentDraft:roleDraft).trim();
  const list=kind==="department"?departments:roles;
  if(value.length<2){setError("Enter at least 2 characters.");return;}
  if(list.some(item=>item.name.toLowerCase()===value.toLowerCase())){setError("That name has already been added.");return;}
  if(kind==="department"){setDepartments(items=>[...items,{name:value,description:departmentDescription.trim()}]);setDepartmentDraft("");setDepartmentDescription("");}
  else{setRoles(items=>[...items,{name:value,description:roleDescription.trim()}]);setRoleDraft("");setRoleDescription("");}
  setError("");
 }
 async function finish(){await run(async()=>{
  if(!auth?.currentUser)throw new Error("Firebase session is missing. Sign in again.");
  if(org.trim().length<2||name.trim().length<2)throw new Error("Enter your organization name and your name.");
  if(!departments.length)throw new Error("Add at least one department.");
  if(!roles.length)throw new Error("Add at least one role.");
  const current=auth.currentUser;await current.reload();
  if(current.email&&!current.emailVerified){setStage("verify");throw new Error("Verify your email before continuing.");}
  const token=await current.getIdToken(true);
  const res=await fetch(API+"/api/v1/auth/organizations/signup",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({organization_name:org.trim(),admin_name:name.trim(),departments,roles})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.detail||`Signup failed (HTTP ${res.status}).`);
  router.replace("/dashboard");
 });}
 const field="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none focus:border-cyan-400";
 const stepTitles=["Organization identity","Departments","Organization roles"];
 return <main className="min-h-screen bg-slate-950 text-white"><nav className="mx-auto flex max-w-6xl justify-between px-6 py-6"><Link href="/" className="text-xl font-bold"><span className="text-cyan-400">Savira</span>Cortex</Link><Link href="/login" className="text-sm text-slate-400">Already registered? Sign in</Link></nav>
 <section className="mx-auto grid max-w-6xl gap-12 px-6 py-12 md:grid-cols-2 md:items-center"><div><p className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-300">CREATE YOUR WORKSPACE</p><h1 className="mt-6 text-4xl font-semibold sm:text-5xl">One identity. <span className="text-cyan-400">Your workspace.</span></h1><p className="mt-5 leading-7 text-slate-400">Set up your organization in three simple steps. Nothing is created until you review and submit the final step.</p></div>
 <div className="rounded-3xl border border-slate-800 bg-slate-900 p-7 shadow-2xl sm:p-9">
 {stage==="wizard"&&<div className="mb-7 flex items-center gap-2">{[1,2,3].map(n=><div key={n} className="flex flex-1 items-center gap-2"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${wizardStep===n?"border-cyan-300 text-cyan-300":wizardStep>n?"border-cyan-400 bg-cyan-400 text-slate-950":"border-slate-700 text-slate-500"}`}>{wizardStep>n?"✓":n}</div><span className={`hidden text-xs sm:inline ${wizardStep===n?"text-white":"text-slate-500"}`}>{["Organization","Departments","Roles"][n-1]}</span>{n<3&&<div className="h-px flex-1 bg-slate-800"/>}</div>)}</div>}
 <h2 className="text-2xl font-semibold">{stage==="wizard"?`Step ${wizardStep} of 3 · ${stepTitles[wizardStep-1]}`:stage==="verify"?"Verify your email":"Create your account"}</h2>
 {stage==="identity"&&<><div className="mt-6 grid grid-cols-3 gap-2">{(["email","google","phone"] as Provider[]).map(p=><button key={p} onClick={()=>{setProvider(p);setError("");}} className={`rounded-xl border p-2 text-sm capitalize ${provider===p?"border-cyan-400 bg-cyan-400/10 text-cyan-300":"border-slate-700 text-slate-400"}`}>{p}</button>)}</div>
 {provider==="email"&&<form onSubmit={emailSignup} className="mt-6 space-y-4"><input required type="email" placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)} className={field}/><input required minLength={6} type="password" placeholder="Password (min 6 characters)" value={password} onChange={e=>setPassword(e.target.value)} className={field}/><button disabled={busy||!auth} className="w-full rounded-xl bg-cyan-400 p-3 font-semibold text-slate-950">Create account & verify email</button></form>}
 {provider==="google"&&<button disabled={busy||!auth} onClick={googleSignup} className="mt-6 w-full rounded-xl border border-slate-700 p-3">Continue with Google</button>}
 {provider==="phone"&&<div className="mt-6 space-y-4"><input type="tel" placeholder="Phone, e.g. +919876543210" value={phone} onChange={e=>setPhone(e.target.value)} className={field}/>{!confirmation?<button disabled={busy||!phone.trim()} onClick={sendCode} className="w-full rounded-xl bg-cyan-400 p-3 font-semibold text-slate-950">Send SMS code</button>:<><input inputMode="numeric" placeholder="SMS verification code" value={otp} onChange={e=>setOtp(e.target.value)} className={field}/><button disabled={busy||!otp.trim()} onClick={verifyCode} className="w-full rounded-xl bg-cyan-400 p-3 font-semibold text-slate-950">Verify phone</button></>}</div>}<div id="register-recaptcha"/></>}
 {stage==="verify"&&<div className="mt-5 space-y-4"><p className="text-sm text-slate-400">We sent a verification link to <strong className="text-white">{user?.email}</strong>.</p><button disabled={busy} onClick={()=>run(async()=>{if(!auth?.currentUser)throw new Error("No signed-in user.");await auth.currentUser.reload();if(!auth.currentUser.emailVerified)throw new Error("Email is not verified yet.");setStage("wizard");})} className="w-full rounded-xl bg-cyan-400 p-3 font-semibold text-slate-950">I verified my email</button><button disabled={busy} onClick={()=>run(async()=>{if(!auth?.currentUser)throw new Error("No signed-in user.");await sendEmailVerification(auth.currentUser);setNotice("Verification email resent.");})} className="w-full rounded-xl border border-slate-700 p-3">Resend verification email</button></div>}
 {stage==="wizard"&&<div className="mt-5 space-y-4">
 {wizardStep===1&&<><p className="text-sm leading-6 text-slate-400">Tell us who you are and what your workspace is called.</p><input required minLength={2} placeholder="Organization name" value={org} onChange={e=>setOrg(e.target.value)} className={field}/><input required minLength={2} placeholder="Your name / username" value={name} onChange={e=>setName(e.target.value)} className={field}/></>}
 {wizardStep===2&&<><p className="text-sm leading-6 text-slate-400">Add the departments in your company, such as Engineering, HR, Finance, or Sales.</p><div className="space-y-2"><input value={departmentDraft} onChange={e=>setDepartmentDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addName("department");}}} placeholder="Department name" className={field}/><textarea value={departmentDescription} onChange={e=>setDepartmentDescription(e.target.value)} placeholder="Department description (optional)" rows={2} className={field}/><button onClick={()=>addName("department")} className="rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-slate-950">Add department</button></div><div className="space-y-2">{departments.map(item=><div key={item.name} className="flex items-center justify-between rounded-xl border border-slate-800 px-4 py-3 text-sm"><span>{item.name}{item.description&&<span className="block text-xs text-slate-500">{item.description}</span>}</span><button onClick={()=>setDepartments(xs=>xs.filter(x=>x.name!==item.name))} className="text-slate-500 hover:text-rose-300">Remove</button></div>)}</div></>}
 {wizardStep===3&&<><p className="text-sm leading-6 text-slate-400">Define the roles people can have in your organization, such as Manager, Developer, or Team Lead.</p><div className="space-y-2"><input value={roleDraft} onChange={e=>setRoleDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addName("role");}}} placeholder="Role name" className={field}/><textarea value={roleDescription} onChange={e=>setRoleDescription(e.target.value)} placeholder="Role description (optional)" rows={2} className={field}/><button onClick={()=>addName("role")} className="rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-slate-950">Add role</button></div><div className="space-y-2">{roles.map(item=><div key={item.name} className="flex items-center justify-between rounded-xl border border-slate-800 px-4 py-3 text-sm"><span>{item.name}{item.description&&<span className="block text-xs text-slate-500">{item.description}</span>}</span><button onClick={()=>setRoles(xs=>xs.filter(x=>x.name!==item.name))} className="text-slate-500 hover:text-rose-300">Remove</button></div>)}</div><div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400"><p className="font-medium text-white">Ready to create {org||"your organization"}?</p><p className="mt-1">{departments.length} department(s) · {roles.length} role(s)</p><p className="mt-2 text-xs">Your organization and setup records will be saved together when you submit.</p></div></>}
 <div className="grid grid-cols-2 gap-3 pt-3">{wizardStep>1?<button onClick={()=>setWizardStep(s=>(s-1) as 1|2|3)} className="rounded-xl border border-slate-700 p-3.5 text-slate-300">← Back</button>:<button onClick={()=>run(async()=>{if(auth)await signOut(auth);})} className="rounded-xl border border-slate-700 p-3.5 text-slate-300">Cancel</button>}{wizardStep<3?<button disabled={wizardStep===1?(org.trim().length<2||name.trim().length<2):departments.length===0} onClick={()=>setWizardStep(s=>(s+1) as 1|2|3)} className="rounded-xl bg-cyan-400 p-3.5 font-semibold text-slate-950 disabled:opacity-40">Continue →</button>:<button disabled={busy||roles.length===0||!org.trim()||!name.trim()} onClick={()=>void finish()} className="rounded-xl bg-cyan-400 p-3.5 font-semibold text-slate-950 disabled:opacity-40">{busy?"Creating…":"Create organization"}</button>}</div>
 </div>}
 {notice&&<p role="status" className="mt-4 text-sm text-emerald-300">{notice}</p>}{error&&<p role="alert" className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}
 {stage!=="identity"&&<button onClick={()=>run(async()=>{if(auth)await signOut(auth);setConfirmation(null);})} className="mt-5 w-full text-sm text-slate-500 underline">Cancel and sign out</button>}
 <p className="mt-6 text-center text-xs text-slate-500">Your organization is only registered after the final submission.</p></div></section></main>;
}
